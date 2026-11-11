import type { RenderStep } from "../render/protocol";

/** Player states after the build itself has completed. */
const BUILT_STATES: ReadonlySet<string> = new Set(["finale", "done", "live"]);
/** Frames timed before an ETA is offered; the first frames include loading. */
const ETA_MIN_FRAMES = 5;

/** Engine time of frame `n`, from the index, so steps never add up rounding drift. */
export function frameTime(n: number, fps: number): number {
  return (n * 1000) / fps;
}

/** Presentation time of frame `n` in whole microseconds (WebCodecs and container timestamps). */
export function frameMicros(n: number, fps: number): number {
  return Math.round((n * 1_000_000) / fps);
}

/** The render page side of the loop: the same two calls the CLI makes over CDP. */
export interface FrameDriver {
  /** Advances the page's clock by `ms` and resolves once the frame is ready. */
  step(ms: number): Promise<RenderStep>;
  /** Captures and encodes frame `index`, which shows engine time `timeMs`. */
  capture(index: number, timeMs: number): Promise<void>;
}

/** Where an export stands, after each frame. */
export interface FrameProgress {
  /** Frames captured so far. */
  frames: number;
  /** Best guess of the final frame count; grows when the build runs longer than estimated. */
  totalFrames: number;
  /** Layers built and layer count. */
  built: number;
  layers: number;
  /** Wall time since the first frame, ms. */
  elapsedMs: number;
  /** Wall time left, ms, or null until a few frames have been timed. */
  etaMs: number | null;
}

export interface FrameScheduleOptions {
  fps: number;
  /** Hard cap on frames (a build that never ends). */
  maxFrames: number;
  /** Frames the render page expects (from `init().estimatedMs`), for progress before the build ends. */
  estimatedFrames: number;
  /** Hold after the build (`RenderInit.tail`), ms: once the build ends the frame count is known. */
  tailMs: number;
  signal?: AbortSignal;
  onProgress?(progress: FrameProgress): void;
  /** Wall clock for the ETA. Default `performance.now`. */
  now?: () => number;
  /** Lets the page handle input between frames. Default: a message-channel task (not throttled in hidden tabs). */
  yieldToUi?: () => Promise<void>;
}

export interface FrameScheduleResult {
  frames: number;
  /** Video length: frames / fps, ms. */
  durationMs: number;
  /** Engine time of the first frame that showed the build complete, or null if none did. */
  builtAtMs: number | null;
  /** False when `maxFrames` cut the build short. */
  finished: boolean;
  last: RenderStep;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The export was cancelled.", "AbortError");
}

/**
 * Frame count to expect while the build runs: the render page's estimate until the build outlasts
 * it, then the frames so far scaled by the share of layers built, plus the tail.
 */
function expectedFrames(frames: number, last: RenderStep, estimated: number, tailFrames: number): number {
  if (frames < estimated - tailFrames || last.built <= 0 || last.total <= 0) return estimated;
  return Math.ceil((frames * last.total) / last.built) + tailFrames + 1;
}

/** Resolves on a fresh task, so input and rendering can run between frames. */
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * The CLI's frame loop (apps/cli runFrameLoop) for an in-page encoder: captures frame 0 at engine
 * time 0, then alternates `step(frameTime(n) - frameTime(n - 1))` and capture until the page
 * reports `done` (that frame is included) or `maxFrames` is reached. Same steps, same frames.
 *
 * @throws The signal's reason when it aborts; whatever the driver throws.
 */
export async function runFrameSchedule(driver: FrameDriver, o: FrameScheduleOptions): Promise<FrameScheduleResult> {
  const now = o.now ?? (() => performance.now());
  const yieldToUi = o.yieldToUi ?? yieldTask;
  const tailFrames = Math.ceil((o.tailMs * o.fps) / 1000);
  const start = now();
  let last: RenderStep = { state: "init", built: 0, total: 0, done: false };
  let frames = 0;
  let builtAtFrame: number | null = null;
  for (;;) {
    if (o.signal?.aborted) throw abortReason(o.signal);
    await driver.capture(frames, frameTime(frames, o.fps));
    frames += 1;
    if (o.onProgress) {
      const expected =
        builtAtFrame !== null
          ? builtAtFrame + tailFrames + 1
          : expectedFrames(frames, last, o.estimatedFrames, tailFrames);
      const totalFrames = Math.min(o.maxFrames, Math.max(frames + (last.done ? 0 : 1), expected));
      const elapsedMs = now() - start;
      const etaMs = frames >= ETA_MIN_FRAMES ? (elapsedMs / frames) * (totalFrames - frames) : null;
      o.onProgress({ frames, totalFrames, built: last.built, layers: last.total, elapsedMs, etaMs });
    }
    if (last.done || frames >= o.maxFrames) break;
    await yieldToUi();
    if (o.signal?.aborted) throw abortReason(o.signal);
    last = await driver.step(frameTime(frames, o.fps) - frameTime(frames - 1, o.fps));
    if (builtAtFrame === null && BUILT_STATES.has(last.state)) builtAtFrame = frames;
  }
  return {
    frames,
    durationMs: frameTime(frames, o.fps),
    builtAtMs: builtAtFrame === null ? null : frameTime(builtAtFrame, o.fps),
    finished: last.done || builtAtFrame !== null,
    last,
  };
}
