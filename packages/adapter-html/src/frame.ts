import { mayStartAnimations, readStyleFacts } from "@swarmloom/core/internal";
import { type KeyframeTimeline, placeKeyframes, readKeyframes } from "./timeline";

/** Options of {@link renderInFrame}. */
export interface FrameOptions {
  /** Document that hosts the hidden frame. */
  host: Document;
  /** Prepared document markup (see prepareDocument). */
  html: string;
  /** Frame viewport in CSS px. */
  width: number;
  height: number;
  /** Give up waiting for the load event after this many ms. */
  loadTimeoutMs: number;
  /** Extra wait after load (fonts, images) before animations are frozen. */
  settleMs: number;
  /** Pose of infinite animations as a fraction of one cycle. Default 0.5. */
  infinitePhase?: number;
  /** Also read the keyframe timelines of animated elements before they are frozen. Default false. */
  keyframes?: boolean;
  signal?: AbortSignal;
}

/** A laid-out document inside a hidden frame. Call `dispose()` when done. */
export interface FrameDocument {
  doc: Document;
  frame: HTMLIFrameElement;
  /** False when the load event did not arrive in time (slow subresources); the DOM is still usable. */
  loaded: boolean;
  /** The animations frozen for the capture. */
  frozen: FrozenAnimations;
  /** Keyframe timelines of animated elements, when {@link FrameOptions.keyframes} asked for them. */
  timelines?: KeyframeTimeline[];
  dispose(): void;
}

/** Result of {@link freezeAnimations}. */
export interface FrozenAnimations {
  /** Finite animations and transitions moved to their end state. */
  finished: number;
  /** Infinite animations paused at the chosen phase. */
  paused: number;
  /**
   * False when the poses of the last pass ({@link FREEZE_PASSES}) still started new animations: those
   * are not frozen and run on wall time, so captures of the page may differ.
   */
  settled: boolean;
  /** Lets the paused infinite animations run again from their pose (used after go live). */
  resume(): void;
}

const FONT_TIMEOUT_MS = 3000;
const IMAGE_TIMEOUT_MS = 4000;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolves true on the frame's load event, false after `ms`. Rejects on abort. */
function waitForLoad(frame: HTMLIFrameElement, ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      frame.removeEventListener("load", onLoad);
      signal?.removeEventListener("abort", onAbort);
    };
    const onLoad = () => {
      cleanup();
      resolve(true);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, ms);
    frame.addEventListener("load", onLoad);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function nextFrame(win: Window, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      reject(error);
    };
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(finish);
    else setTimeout(finish, 16);
    // WebKit may not service animation frames inside the opacity-zero browser-export frame.
    void delay(80, signal).then(finish, fail);
  });
}

/** Waits until every `<img>` has loaded or failed, at most `ms`. */
async function imagesSettled(doc: Document, ms: number, signal?: AbortSignal): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  if (pending.length === 0) return;
  const all = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await Promise.race([all, delay(ms, signal)]);
}

/**
 * Most passes (reads of the animation list that freeze what they find) of one freeze. The poses a
 * pass sets can start transitions and animations of their own, which the next pass finds; a chain of
 * them (nested container queries) takes one pass per link, and a pass that finds nothing new ends the
 * freeze. After the last pass one more read only checks for new ones, so the cap only stops a page
 * that is still starting new ones then ({@link FrozenAnimations.settled}).
 */
export const FREEZE_PASSES = 32;

/**
 * Puts every CSS animation, transition and Web Animation of a document into a pose that does not
 * depend on machine speed (decision C02):
 *  - finite ones jump to their end state, the look the page settles into, so entrance effects
 *    (fade-ins starting at opacity 0) are captured visible;
 *  - infinite loops pause `phase` of a cycle after their delay (default half a cycle, which is
 *    rarely the invisible start pose of a pulse or a fade).
 *
 * A pose can set off new ones: a paused font size changes an em-based width with a transition, or
 * a container takes a new size and a container query now starts an animation. Those would run on
 * wall time through the snapshot and on until go live. So after each pass the document is laid out
 * (container queries resolve in layout), the animations are read again and the new ones are frozen
 * the same way, until a pass finds none, at most {@link FREEZE_PASSES} passes (`settled` says whether
 * the freeze got there). Only on pages whose rules let a pose start something: fades, slides and
 * pulses start nothing, and their pages are read once.
 *
 * The contents of `content-visibility: auto` elements count too: they show while the passes run (see
 * {@link withSkippedContents}), as an off-screen capture frame leaves them all unstyled.
 * Returns counts and a `resume()` that lets the loops run again.
 */
export function freezeAnimations(doc: Document, phase = 0.5): FrozenAnimations {
  return withSkippedContents(doc, () => freezeShown(doc, phase));
}

/** An element whose `content-visibility: auto` {@link withSkippedContents} turned off, with its own `style` attribute. */
interface ShownElement {
  el: Element;
  attr: string | null;
}

/**
 * Sets every `content-visibility: auto` element of `doc` to `visible` (inline, important), then lays
 * the document out. One nesting level at a time: the styles outside the found elements are all read
 * before any of them is set, and their subtrees are read in the next pass. So a nested one is read
 * with the contents around it shown (a style read inside skipped contents starts their animations at
 * their first keyframe and keeps that pose), and the document is restyled once per level: a read
 * after each write restyled it once per element, which took seconds on pages with thousands of sections.
 */
function showSkippedContents(doc: Document): ShownElement[] {
  const win = doc.defaultView;
  const root = doc.documentElement;
  const shown: ShownElement[] = [];
  if (!win || !root) return shown;
  for (let level = findAutoElements(win, [root]); level.length > 0; ) {
    for (const el of level) {
      shown.push({ el, attr: el.getAttribute("style") });
      (el as unknown as ElementCSSInlineStyle).style.setProperty("content-visibility", "visible", "important");
    }
    const inside = level.flatMap((el) => Array.from(el.children));
    level = findAutoElements(win, inside);
  }
  if (shown.length > 0) void root.getBoundingClientRect();
  return shown;
}

/**
 * The `content-visibility: auto` elements among `starts` and their descendants, in no set order. Only
 * reads styles: the subtree of a found element is not read, as its contents are still skipped.
 */
function findAutoElements(win: Window, starts: Element[]): Element[] {
  const found: Element[] = [];
  const stack = starts.slice();
  for (let el = stack.pop(); el; el = stack.pop()) {
    // Duck-typed: the frame's elements come from another realm.
    const style = (el as Partial<ElementCSSInlineStyle>).style;
    if (style && win.getComputedStyle(el).getPropertyValue("content-visibility") === "auto") found.push(el);
    else for (const child of Array.from(el.children)) stack.push(child);
  }
  return found;
}

/**
 * Runs `run` while the contents of the document's `content-visibility: auto` elements show. In the
 * off-screen capture frame the browser skips all of them: their CSS animations and transitions do
 * not exist yet, so the freeze never saw them, and the snapshot's style reads then started them at
 * their first keyframe and kept that stale pose (entrances captured invisible, loops at their start,
 * both jumping at go live). After `run` the document is laid out once more, which styles the poses
 * `run` set, and each element gets its own `style` attribute back, so the live page behaves as written.
 */
function withSkippedContents<T>(doc: Document, run: () => T): T {
  const shown = typeof doc.getAnimations === "function" ? showSkippedContents(doc) : [];
  try {
    return run();
  } finally {
    if (shown.length > 0) void doc.documentElement?.getBoundingClientRect();
    for (const { el, attr } of shown) {
      if (attr !== null) el.setAttribute("style", attr);
      // Read first: Chromium writes a CSSOM change to the attribute lazily, and removing it before
      // that only empties the declarations, which a later read writes out as `style=""`.
      else if (el.getAttribute("style") !== null) el.removeAttribute("style");
    }
  }
}

/** {@link freezeAnimations} once the skipped contents show. */
function freezeShown(doc: Document, phase = 0.5): FrozenAnimations {
  const fraction = Number.isFinite(phase) ? Math.min(1, Math.max(0, phase)) : 0.5;
  const seen = new Set<Animation>();
  const loops: Animation[] = [];
  let finished = 0;
  let settled = typeof doc.getAnimations !== "function";
  // One read more than the passes: the read after the last pass only checks whether its poses
  // started anything, so a chain exactly FREEZE_PASSES long counts as settled.
  for (let pass = 0; pass <= FREEZE_PASSES && !settled; pass++) {
    if (pass > 0) void doc.documentElement?.getBoundingClientRect();
    const fresh = doc.getAnimations().filter((anim) => !seen.has(anim));
    settled = fresh.length === 0;
    if (pass === FREEZE_PASSES) break;
    for (const anim of fresh) {
      seen.add(anim);
      const timing = anim.effect?.getComputedTiming();
      if (!timing) continue;
      try {
        if (Number.isFinite(timing.endTime)) {
          anim.finish();
          finished++;
          continue;
        }
        const cycle = typeof timing.duration === "number" && Number.isFinite(timing.duration) ? timing.duration : 0;
        anim.pause();
        anim.currentTime = (timing.delay ?? 0) + fraction * cycle;
        loops.push(anim);
      } catch {
        // finish() throws for zero playback rates; such animations already sit still.
      }
    }
    if (pass === 0 && !settled && !posesMayStart(doc, fresh)) settled = true;
  }
  return {
    finished,
    paused: loops.length,
    settled,
    resume() {
      for (const anim of loops) {
        try {
          anim.play();
        } catch {
          // The element left the document; nothing to resume.
        }
      }
    },
  };
}

/**
 * Whether the poses the first pass gave `frozen` can start transitions or animations in `doc`
 * ({@link mayStartAnimations} on the document's rules). Reading the animations again is the costly
 * part of the freeze (Chromium sorts them by tree order), so only such a page is read again. A
 * transition the pass finished changes its own property, which no `@keyframes` rule names; a
 * script-made animation's keyframes are in no rule at all, so it counts as starting something.
 */
function posesMayStart(doc: Document, frozen: readonly Animation[]): boolean {
  const facts = readStyleFacts(doc);
  for (const anim of frozen) {
    // Duck-typed: the frame's animations come from another realm.
    if ("transitionProperty" in anim) facts.animated.add(String(anim.transitionProperty));
    else if (!("animationName" in anim)) return true;
  }
  return mayStartAnimations([facts]);
}

/**
 * Lays out a full HTML document in a hidden, sandboxed frame (`srcdoc`). The sandbox only has
 * `allow-same-origin`, so the snapshotter can read the frame DOM while scripts, forms, popups and
 * navigation stay off; the CSP in the prepared document limits subresources. The frame sits
 * off-screen at the given viewport size; after load the function waits for fonts, images and the
 * settle time, then freezes animations.
 */
export async function renderInFrame(opts: FrameOptions): Promise<FrameDocument> {
  const { host } = opts;
  const frame = host.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("title", "SwarmLoom capture frame");
  frame.style.cssText =
    `position:fixed;left:-${opts.width + 10000}px;top:0;width:${opts.width}px;height:${opts.height}px;` +
    "border:0;margin:0;padding:0;pointer-events:none;contain:strict;";
  frame.srcdoc = opts.html;
  const dispose = () => frame.remove();

  try {
    const loading = waitForLoad(frame, opts.loadTimeoutMs, opts.signal);
    (host.body ?? host.documentElement).appendChild(frame);
    const loaded = await loading;
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win || !doc.documentElement || doc.URL !== "about:srcdoc") {
      throw new Error("html: the capture frame did not load the document");
    }
    if (!doc.body && doc.readyState === "loading") {
      throw new Error(`html: the document did not finish parsing within ${opts.loadTimeoutMs} ms`);
    }
    await Promise.all([
      Promise.race([doc.fonts?.ready, delay(FONT_TIMEOUT_MS, opts.signal)]),
      imagesSettled(doc, IMAGE_TIMEOUT_MS, opts.signal),
    ]);
    await delay(opts.settleMs, opts.signal);
    await nextFrame(win, opts.signal);
    // Timings before the freeze (finished animations may leave the list), boxes after it.
    const { timings, frozen } = withSkippedContents(doc, () => ({
      timings: opts.keyframes ? readKeyframes(doc, opts.infinitePhase) : null,
      frozen: freezeShown(doc, opts.infinitePhase),
    }));
    await nextFrame(win, opts.signal);
    const timelines = timings ? placeKeyframes(timings) : undefined;
    return { doc, frame, loaded, frozen, dispose, ...(timelines ? { timelines } : {}) };
  } catch (error) {
    dispose();
    throw error;
  }
}
