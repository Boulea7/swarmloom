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
 * Reads of the animation list after the first pass: the poses a pass sets can start transitions and
 * animations of their own, which a later read finds.
 */
const FREEZE_ROUNDS = 4;

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
 * the same way, up to {@link FREEZE_ROUNDS} more passes.
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
 * the document out. Document order sets an ancestor first, so the style of a nested one is read with
 * the contents around it shown: a style read inside skipped contents starts their animations at
 * their first keyframe and keeps that pose.
 */
function showSkippedContents(doc: Document): ShownElement[] {
  const win = doc.defaultView;
  const shown: ShownElement[] = [];
  if (!win) return shown;
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    // Duck-typed: the frame's elements come from another realm.
    const style = (el as Partial<ElementCSSInlineStyle>).style;
    if (!style || win.getComputedStyle(el).getPropertyValue("content-visibility") !== "auto") continue;
    shown.push({ el, attr: el.getAttribute("style") });
    style.setProperty("content-visibility", "visible", "important");
  }
  if (shown.length > 0) void doc.documentElement?.getBoundingClientRect();
  return shown;
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
  for (let round = 0; round <= FREEZE_ROUNDS && typeof doc.getAnimations === "function"; round++) {
    if (round > 0) void doc.documentElement?.getBoundingClientRect();
    const fresh = doc.getAnimations().filter((anim) => !seen.has(anim));
    if (fresh.length === 0) break;
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
  }
  return {
    finished,
    paused: loops.length,
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
