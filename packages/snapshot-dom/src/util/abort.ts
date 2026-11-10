/** Throws the signal's reason (an AbortError DOMException by default) when it is aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The snapshot was aborted", "AbortError");
}

/** Resolves after `ms`, or rejects early when the signal aborts. Not used on any engine timing path. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
