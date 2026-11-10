/**
 * Raised for files this package cannot or will not read: malformed containers, unsupported
 * legacy formats, inputs over a safety limit. The message is user-facing English.
 */
export class OfficeFormatError extends Error {
  override readonly name = "OfficeFormatError";
}

/** Throws the signal's reason (or an AbortError) when the load was cancelled. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("The load was aborted", "AbortError");
}

/** Lets the browser paint between expensive parse steps of a large file. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
