/** Machine-readable reasons a 3D source was rejected. */
export type ThreeErrorCode =
  | "empty"
  | "too-large"
  | "unsupported-format"
  | "invalid"
  | "external-resource"
  | "unsupported-extension"
  | "needs-decoder"
  | "no-geometry"
  | "fetch-failed";

/**
 * Error thrown by the three adapter for input it cannot or will not play.
 *
 * The message is English and user-presentable; `code` lets shells map it to a translated hint.
 */
export class ThreeAdapterError extends Error {
  readonly code: ThreeErrorCode;

  constructor(code: ThreeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThreeAdapterError";
    this.code = code;
  }
}

/** Throws the signal's reason (an AbortError) when it is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The load was aborted", "AbortError");
  }
}
