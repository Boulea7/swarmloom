import { isElement, viewOf } from "../dom/env";
import { delay, throwIfAborted } from "../util/abort";
import { px } from "../util/css";
import type { Shell } from "./state";

/** Elements inspected while looking for an app-shell scroller. */
const SCAN_LIMIT = 20_000;
const MIN_OVERFLOW = 16;

function scrollsY(cs: CSSStyleDeclaration): boolean {
  const o = cs.overflowY;
  return o === "auto" || o === "scroll" || o === "overlay";
}

/** True when the document itself scrolls (content taller than the viewport). */
export function documentScrolls(doc: Document): boolean {
  const se = doc.scrollingElement ?? doc.documentElement;
  if (!se) return false;
  const view = viewOf(doc);
  const cs = view.getComputedStyle(doc.documentElement);
  const body = doc.body;
  const bodyCs = body ? view.getComputedStyle(body) : null;
  if (
    cs.overflowY === "hidden" ||
    cs.overflowY === "clip" ||
    bodyCs?.overflowY === "hidden" ||
    bodyCs?.overflowY === "clip"
  ) {
    return false;
  }
  return se.scrollHeight - se.clientHeight > MIN_OVERFLOW;
}

/** Builds the shell record of a scroller from its current geometry. */
export function shellOf(el: Element): Shell {
  const cs = viewOf(el).getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const vTop = r.top + px(cs.borderTopWidth);
  return { el, vTop, vBottom: vTop + el.clientHeight, delta: Math.max(0, el.scrollHeight - el.clientHeight) };
}

/**
 * Finds the main scroller of an app-shell layout (document does not scroll, one large inner
 * element does). Returns null for ordinary documents. Read-only.
 */
export function findMainScroller(doc: Document): Element | null {
  if (documentScrolls(doc)) return null;
  const view = viewOf(doc);
  const vw = view.innerWidth;
  const vh = view.innerHeight;
  let best: Element | null = null;
  let bestArea = 0;
  let scanned = 0;
  const stack: Element[] = [];
  if (doc.body) stack.push(doc.body);
  while (stack.length > 0 && scanned < SCAN_LIMIT) {
    const el = stack.pop() as Element;
    scanned++;
    const ch = el.clientHeight;
    const cw = el.clientWidth;
    if (ch >= vh * 0.4 && cw >= vw * 0.33 && el.scrollHeight - ch > MIN_OVERFLOW) {
      const cs = view.getComputedStyle(el);
      if (scrollsY(cs) && cs.display !== "none" && cs.visibility !== "hidden") {
        const area = cw * ch;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
    }
    const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    const kids = shadow ? shadow.children : el.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k && isElement(k)) stack.push(k);
    }
  }
  return best;
}

/** True when an element scrolls vertically and has hidden overflow content. */
export function elementScrolls(el: Element): boolean {
  if (el.scrollHeight - el.clientHeight <= MIN_OVERFLOW) return false;
  return scrollsY(viewOf(el).getComputedStyle(el));
}

/**
 * Resolves once the next frame has been rendered at the current scroll position. Intersection
 * observers and lazy loading look at the page after the animation frame callbacks, so resolving in
 * the callback let the next step scroll away first and the page never saw some positions.
 */
function nextFrame(view: Window, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof view.requestAnimationFrame === "function") view.requestAnimationFrame(() => view.setTimeout(finish, 0));
    // Background tabs throttle animation frames: never wait more than a short delay.
    void delay(80, signal).then(finish, finish);
  });
}

/** Prescroll budget: steps, wall time and document growth (infinite feeds stop the pass). */
const MAX_STEPS = 16;
const MAX_PRESCROLL_MS = 2500;
const MAX_GROWTH = 1.3;

/**
 * Scrolls through the page (or the app-shell scroller) once so lazy content loads, then
 * restores the original scroll position (verified, retried once) and waits briefly for newly
 * requested images. Stops after 16 steps, 2.5 s, or when the content grew by more than 30%.
 */
export async function prescroll(doc: Document, signal?: AbortSignal): Promise<void> {
  const view = viewOf(doc);
  const shell = findMainScroller(doc);
  const target: Element | null = shell ?? doc.scrollingElement ?? doc.documentElement;
  if (!target) return;
  const startX = shell ? shell.scrollLeft : view.scrollX;
  const startY = shell ? shell.scrollTop : view.scrollY;
  const page = shell ? shell.clientHeight : view.innerHeight;
  const startHeight = target.scrollHeight;
  const scrollTo = (y: number) => {
    if (shell) shell.scrollTo({ left: startX, top: y, behavior: "instant" });
    else view.scrollTo({ left: startX, top: y, behavior: "instant" });
  };
  const currentY = () => (shell ? shell.scrollTop : view.scrollY);
  const started = view.performance.now();
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      throwIfAborted(signal);
      const max = target.scrollHeight - page;
      const y = Math.min(max, step * page * 0.9);
      if (y <= 0) break;
      scrollTo(y);
      await nextFrame(view, signal);
      if (y >= max || target.scrollHeight > startHeight * MAX_GROWTH) break;
      if (view.performance.now() - started > MAX_PRESCROLL_MS) break;
    }
  } finally {
    scrollTo(startY);
  }
  await nextFrame(view, signal);
  if (Math.abs(currentY() - startY) > 1) {
    scrollTo(startY);
    await nextFrame(view, signal);
  }
  await waitForImages(doc, 1000, signal);
}

/** Waits until every `<img>` in the document finished loading (or failed), at most `timeout` ms. */
export async function waitForImages(
  root: Document | ShadowRoot | Element,
  timeout: number,
  signal?: AbortSignal,
): Promise<void> {
  const pending = Array.from(root.querySelectorAll("img")).filter((img) => !img.complete);
  if (pending.length === 0) return;
  const loads = pending.map(
    (img) =>
      new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }),
  );
  await Promise.race([Promise.all(loads), delay(timeout, signal).catch(() => undefined)]);
  throwIfAborted(signal);
}
