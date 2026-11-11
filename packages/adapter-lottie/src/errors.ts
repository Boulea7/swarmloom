/** Why a Lottie input was rejected. */
export type LottieErrorCode =
  /** Not JSON, or JSON that is not a Lottie animation. */
  | "invalid"
  /** Over a size, depth or count limit. */
  | "too-large"
  /** Valid Lottie that relies on something SwarmLoom does not run (expressions-only motion). */
  | "unsupported"
  /** Broken or unsafe .lottie archive. */
  | "archive"
  /** lottie-web could not build the animation. */
  | "render";

/**
 * Error thrown by the Lottie adapter. `message` is written for end users (it says what was wrong
 * and, where possible, what to do) in English; `code` lets callers branch or translate without
 * parsing it (Studio maps each code to its own localized message).
 */
export class LottieError extends Error {
  override readonly name = "LottieError";

  constructor(
    readonly code: LottieErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Throws the signal's reason when it is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
