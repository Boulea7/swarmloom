import { throwIfAborted } from "../errors";
import type { StepResult } from "./protocol";

/** The two operations the frame loop needs from a loaded render page. */
export interface FrameSource {
  /** Advances the page's virtual clock by `ms` and waits until the frame is ready. */
  step(ms: number): Promise<StepResult>;
  /** Encoded screenshot of the current frame. */
  capture(): Promise<Uint8Array>;
}

/** Receives frames in order; resolving signals readiness for the next one (backpressure). */
export type FrameSink = (frame: Uint8Array, index: number) => Promise<void>;

export interface FrameLoopOptions {
  fps: number;
  /** Hard cap on captured frames (the --max-duration guard). */
  maxFrames: number;
  /** Stop at the frame the page reports done (default). False captures exactly `maxFrames` (--duration). */
  untilDone?: boolean;
  signal?: AbortSignal;
  /** Called after every captured frame. */
  onFrame?(index: number, step: StepResult): void;
}

export interface FrameLoopResult {
  frames: number;
  /** Video length: frames / fps, in ms. */
  durationMs: number;
  /** Engine time of the last captured frame, in ms. */
  elapsedMs: number;
  /** False when the loop stopped at maxFrames before the page reported done. */
  finished: boolean;
  /** Engine time of the first frame that showed the build complete, or null if none did. */
  builtAtMs: number | null;
  last: StepResult;
}

/** Player states after the build itself has completed. */
const BUILT_STATES: ReadonlySet<string> = new Set(["finale", "done", "live"]);

/** Engine time of frame `n`, computed from the index so steps never accumulate rounding drift. */
export function frameTime(n: number, fps: number): number {
  return (n * 1000) / fps;
}

/**
 * Captures frame 0 at engine time 0, then alternates step(1000 / fps) and capture until the page
 * reports `done` (that frame is included) or `maxFrames` is reached; with `untilDone: false` it always
 * captures `maxFrames` frames.
 *
 * @throws InterruptedError when `signal` aborts; whatever the source or sink throws.
 */
export async function runFrameLoop(
  source: FrameSource,
  sink: FrameSink,
  opts: FrameLoopOptions,
): Promise<FrameLoopResult> {
  const untilDone = opts.untilDone ?? true;
  let last: StepResult = { state: "init", built: 0, total: 0, done: false };
  let frames = 0;
  let builtAtMs: number | null = null;
  for (;;) {
    throwIfAborted(opts.signal);
    await sink(await source.capture(), frames);
    frames += 1;
    opts.onFrame?.(frames - 1, last);
    if ((untilDone && last.done) || frames >= opts.maxFrames) break;
    throwIfAborted(opts.signal);
    last = await source.step(frameTime(frames, opts.fps) - frameTime(frames - 1, opts.fps));
    if (builtAtMs === null && BUILT_STATES.has(last.state)) builtAtMs = frameTime(frames, opts.fps);
  }
  return {
    frames,
    durationMs: frameTime(frames, opts.fps),
    elapsedMs: frameTime(frames - 1, opts.fps),
    finished: last.done || builtAtMs !== null,
    builtAtMs,
    last,
  };
}
