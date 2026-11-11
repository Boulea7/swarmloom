import { throwIfAborted } from "../errors";

/** Main-thread work between two host turns, ms (the 8-12 ms slices of behavior-spec §3.8). */
const SLICE_MS = 10;

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

/** Splits one long job into host tasks of about {@link SLICE_MS}. */
export interface Slicer {
  /** Gives the host a turn once the running slice is over; a no-op before that. */
  pause(): Promise<void>;
  /** Gives the host a turn now (after a step that is long on its own). */
  yield(): Promise<void>;
}

/**
 * Creates a slicer whose first slice starts now. After every host turn it throws the signal's
 * reason when the job was aborted meanwhile.
 */
export function createSlicer(signal: AbortSignal | undefined): Slicer {
  let deadline = performance.now() + SLICE_MS;
  const turn = async (): Promise<void> => {
    await yieldToHost();
    throwIfAborted(signal);
    deadline = performance.now() + SLICE_MS;
  };
  return {
    pause: () => (performance.now() < deadline ? Promise.resolve() : turn()),
    yield: turn,
  };
}
