import { InterruptedError, RenderError } from "../errors";

/**
 * Settles with `promise`, or rejects with RenderError after `ms`, or with InterruptedError when
 * `signal` aborts first. The underlying work is not cancelled; callers clean up by closing the
 * browser or killing the process that owns it.
 */
export function guard<T>(promise: Promise<T>, what: string, ms: number, signal?: AbortSignal): Promise<T> {
  // Once the guard settles early, the abandoned promise usually rejects later (cleanup closes the
  // browser under it); observe it so that late rejection cannot crash the process.
  promise.catch(() => {});
  if (signal?.aborted) return Promise.reject(new InterruptedError());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      done();
      reject(new RenderError(`${what} timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
    const onAbort = () => {
      done();
      reject(new InterruptedError());
    };
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        done();
        resolve(value);
      },
      (error: unknown) => {
        done();
        reject(error);
      },
    );
  });
}

/** Resolves when `signal` aborts (used by long-running commands such as `serve`). */
export function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/**
 * Runs registered cleanups in reverse order, never throwing: cleanup must not mask the error
 * that caused it. Failures are reported through `onError`.
 */
export class Cleanup {
  private readonly tasks: Array<() => unknown> = [];

  constructor(private readonly onError: (message: string) => void = () => {}) {}

  /** Registers a cleanup task. */
  defer(task: () => unknown): void {
    this.tasks.push(task);
  }

  /** Runs and forgets every task, most recent first. */
  async run(): Promise<void> {
    while (this.tasks.length) {
      const task = this.tasks.pop();
      try {
        await task?.();
      } catch (error) {
        this.onError(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
