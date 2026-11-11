import { throwIfAborted } from "./abort";

/** Length of one slice of main-thread work (behavior-spec §3.8 step 6: 8-12 ms). */
export const SLICE_MS = 10;

/**
 * Monotonic clock for slice deadlines. It only decides when the walk gives the host a turn; nothing
 * in a Blueprint depends on it.
 */
export function now(): number {
  return performance.now();
}

/** Deadline of the running slice. Sliced work checks it and yields once it has passed. */
export interface Slice {
  deadline: number;
}

/**
 * Lets the host run input, timers and rendering, then resumes. A message-channel task is used
 * because nested timers are clamped to 4 ms and throttled in background tabs.
 */
export function yieldToHost(): Promise<void> {
  if (typeof MessageChannel !== "function") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Hooks around each host turn of a sliced run. */
export interface SliceGuard {
  /** Runs right before the host gets a turn. */
  pause(): void;
  /** Runs after the host's turn; returns false when the work must be abandoned. */
  resume(): boolean;
}

/**
 * Drives `work` slice by slice: it runs until it yields (its slice deadline passed), then the host
 * gets a turn and an abort is honoured. `guard` sees each turn and can stop the run.
 * @returns true when the work finished, false when `guard.resume` stopped it.
 * @throws The signal's reason when it aborts, or whatever `work` throws.
 */
export async function runSliced(
  work: Iterator<void, void, void>,
  slice: Slice,
  signal: AbortSignal | undefined,
  guard?: SliceGuard,
): Promise<boolean> {
  try {
    for (;;) {
      slice.deadline = now() + SLICE_MS;
      if (work.next().done) return true;
      guard?.pause();
      await yieldToHost();
      throwIfAborted(signal);
      if (guard && !guard.resume()) return false;
    }
  } finally {
    // Runs the walk's pending finally blocks when it stops early; a no-op once it has finished.
    work.return?.();
  }
}
