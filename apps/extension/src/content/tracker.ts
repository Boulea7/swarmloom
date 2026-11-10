/**
 * `tracker.js`: finds the element for "Rebuild this element".
 *
 * Context menu events carry no element in Chromium or Safari, so the tracker remembers the target
 * of the last `contextmenu` event in this frame (injected after each run and before each element
 * rebuild). Resolution order: Firefox `menus.getTargetElement`, the remembered target, the menu's
 * media/link/selection hints, then a pick mode (hover highlight, click to choose, Esc to cancel).
 */

import { type ExtensionApi, menusApi } from "../shared/api";
import { GLOBALS, MSG, type TargetHints } from "../shared/messages";
import { IGNORE_ATTR, UI_TAG } from "./ui";

/** A remembered target older than this is ignored. */
const REMEMBER_MS = 60_000;
/** Smallest box worth rebuilding on its own. */
const MIN_BLOCK = 48;
const PICK_TIMEOUT_MS = 60_000;

export type ResolveResult = "found" | "picking";

export interface Tracker {
  resolve(hints: unknown): ResolveResult;
  /** Leaves pick mode without choosing. */
  cancelPick(): void;
  readonly picking: boolean;
}

type Scope = Record<string, unknown>;

function parseHints(value: unknown): TargetHints {
  const r = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length <= 8192 ? v : undefined);
  return {
    srcUrl: str(r.srcUrl),
    linkUrl: str(r.linkUrl),
    selectionText: str(r.selectionText),
    targetElementId: Number.isInteger(r.targetElementId) ? (r.targetElementId as number) : undefined,
    prompt: str(r.prompt),
  };
}

function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return (root as ShadowRoot).host ?? null;
}

function eventElement(e: Event): Element | null {
  const first = e.composedPath()[0] as Node | undefined;
  if (!first) return null;
  return first.nodeType === 1 ? (first as Element) : ((first as Node).parentElement ?? null);
}

/**
 * Walks up from `el` to the first box that is worth rebuilding on its own: at least 48x48 CSS px,
 * not inline, and not the whole page (body/html return null; the caller then rebuilds the page).
 */
export function meaningfulBlock(el: Element, doc: Document, view: Window): Element | null {
  for (let cur: Element | null = el; cur; cur = composedParent(cur)) {
    if (cur === doc.body || cur === doc.documentElement) return null;
    if (cur.hasAttribute(IGNORE_ATTR)) return null;
    const rect = cur.getBoundingClientRect();
    const display = view.getComputedStyle(cur).display;
    if (rect.width >= MIN_BLOCK && rect.height >= MIN_BLOCK && display !== "inline" && display !== "contents") {
      return cur;
    }
  }
  return null;
}

function findBySrc(doc: Document, src: string): Element | null {
  for (const el of doc.querySelectorAll("img, video, audio, picture source, video source")) {
    const media = el as HTMLImageElement & HTMLMediaElement;
    if (media.currentSrc === src || media.src === src) return el.localName === "source" ? el.parentElement : el;
  }
  return null;
}

function findLink(doc: Document, href: string): Element | null {
  for (const a of doc.querySelectorAll("a[href]")) {
    if ((a as HTMLAnchorElement).href === href) return a;
  }
  return null;
}

function selectionElement(view: Window): Element | null {
  const selection = view.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** Installs the tracker once per frame and returns it. */
export function installTracker(scope: Scope, doc: Document, view: Window, api: ExtensionApi | null): Tracker {
  const existing = scope[GLOBALS.tracker] as Tracker | undefined;
  if (existing && typeof existing.resolve === "function") return existing;

  let last: WeakRef<Element> | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  let endPick: (() => void) | null = null;

  doc.addEventListener(
    "contextmenu",
    (e) => {
      const el = eventElement(e);
      if (!el) return;
      last = new WeakRef(el);
      lastAt = view.performance.now();
    },
    { capture: true, passive: true },
  );

  function remembered(): Element | null {
    if (!last || view.performance.now() - lastAt > REMEMBER_MS) return null;
    const el = last.deref();
    return el?.isConnected ? el : null;
  }

  function choose(el: Element): void {
    scope[GLOBALS.target] = el;
  }

  function startPick(prompt: string | undefined): void {
    if (endPick) return;
    const host = doc.createElement(UI_TAG);
    host.setAttribute(IGNORE_ATTR, "");
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .box { position: fixed; z-index: 2147483646; pointer-events: none; border: 2px solid #5B5BF7;
        background: rgb(91 91 247 / 12%); border-radius: 6px; display: none; }
      .tip { position: fixed; z-index: 2147483647; top: 12px; left: 50%; transform: translateX(-50%);
        padding: 8px 14px; border-radius: 999px; background: #0B0B12; color: #FAFAFC; pointer-events: none;
        font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: calc(100vw - 32px); }`;
    const box = doc.createElement("div");
    box.className = "box";
    const tip = doc.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "status");
    tip.textContent = prompt ?? "";
    root.append(style, box, tip);
    doc.documentElement.append(host);

    let hovered: Element | null = null;
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (!hovered) {
        box.style.display = "none";
        return;
      }
      const r = hovered.getBoundingClientRect();
      box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    };
    const onMove = (e: Event) => {
      const el = eventElement(e);
      hovered = el ? meaningfulBlock(el, doc, view) : null;
      if (!frame) frame = view.requestAnimationFrame(paint);
    };
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const onClick = (e: Event) => {
      swallow(e);
      const el = eventElement(e);
      const block = el ? meaningfulBlock(el, doc, view) : null;
      if (block) finish(block);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        swallow(e);
        finish(null);
      } else if (e.key === "Enter" && doc.activeElement && doc.activeElement !== doc.body) {
        // Keyboard users: pick the block around the focused element.
        const block = meaningfulBlock(doc.activeElement, doc, view);
        if (block) {
          swallow(e);
          finish(block);
        }
      }
    };
    const blocked = ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"] as const;
    const timer = view.setTimeout(() => finish(null), PICK_TIMEOUT_MS);

    function finish(block: Element | null): void {
      endPick?.();
      if (!block) return;
      choose(block);
      api?.runtime.sendMessage({ type: MSG.elementPicked }).catch(() => undefined);
    }

    endPick = () => {
      endPick = null;
      view.clearTimeout(timer);
      if (frame) view.cancelAnimationFrame(frame);
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
      for (const type of blocked) doc.removeEventListener(type, swallow, true);
      host.remove();
    };
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
    for (const type of blocked) doc.addEventListener(type, swallow, true);
  }

  const tracker: Tracker = {
    resolve(raw) {
      const hints = parseHints(raw);
      let el: Element | null = null;
      const menus = api ? menusApi(api) : undefined;
      if (hints.targetElementId !== undefined && typeof menus?.getTargetElement === "function") {
        el = menus.getTargetElement(hints.targetElementId);
      }
      el ??= remembered();
      if (!el && hints.srcUrl) el = findBySrc(doc, hints.srcUrl);
      if (!el && hints.linkUrl) el = findLink(doc, hints.linkUrl);
      if (!el && hints.selectionText) el = selectionElement(view);
      const block = el ? meaningfulBlock(el, doc, view) : null;
      if (block) {
        choose(block);
        return "found";
      }
      startPick(hints.prompt);
      return "picking";
    },
    cancelPick() {
      endPick?.();
    },
    get picking() {
      return endPick !== null;
    },
  };
  scope[GLOBALS.tracker] = tracker;
  return tracker;
}
