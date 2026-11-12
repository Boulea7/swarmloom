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
 * Puts every CSS animation, transition and Web Animation of a document into a pose that does not
 * depend on machine speed (decision C02):
 *  - finite ones jump to their end state, the look the page settles into, so entrance effects
 *    (fade-ins starting at opacity 0) are captured visible;
 *  - infinite loops pause `phase` of a cycle after their delay (default half a cycle, which is
 *    rarely the invisible start pose of a pulse or a fade).
 * Returns counts and a `resume()` that lets the loops run again.
 */
export function freezeAnimations(doc: Document, phase = 0.5): FrozenAnimations {
  const fraction = Number.isFinite(phase) ? Math.min(1, Math.max(0, phase)) : 0.5;
  const all = typeof doc.getAnimations === "function" ? doc.getAnimations() : [];
  const loops: Animation[] = [];
  let finished = 0;
  for (const anim of all) {
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
    const timings = opts.keyframes ? readKeyframes(doc, opts.infinitePhase) : null;
    const frozen = freezeAnimations(doc, opts.infinitePhase);
    await nextFrame(win, opts.signal);
    const timelines = timings ? placeKeyframes(timings) : undefined;
    return { doc, frame, loaded, frozen, dispose, ...(timelines ? { timelines } : {}) };
  } catch (error) {
    dispose();
    throw error;
  }
}
