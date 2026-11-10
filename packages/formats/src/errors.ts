/**
 * Machine-readable reason of a {@link SourceError}. UIs translate through i18n keys `error.<code>`
 * and fall back to the English `message`.
 */
export type SourceErrorCode =
  /** No adapter recognises the input. */
  | "unsupported"
  /** The input exceeds the byte limit (`LoadOptions.maxBytes`). */
  | "too-large"
  /** The input has no content. */
  | "empty"
  /** The document is password-protected. */
  | "encrypted"
  /** Fetching a URL failed (network, CORS, HTTP status). */
  | "fetch-failed"
  /** The adapter chunk could not be imported (offline, missing file). */
  | "adapter-unavailable";

/**
 * Error thrown by `load()` and `fetchSource()` for problems with the input itself. Aborts are not
 * wrapped: they reject with the signal's reason (an `AbortError` DOMException by default).
 */
export class SourceError extends Error {
  override readonly name = "SourceError";
  readonly code: SourceErrorCode;
  /** Detected or requested adapter id, when known. */
  readonly format?: string;

  constructor(code: SourceErrorCode, message: string, options?: { cause?: unknown; format?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    if (options?.format) this.format = options.format;
  }
}

/** Human-readable size: 1536 -> "1.5 KB", 52428800 -> "50 MB". */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : Number(value.toFixed(1))} ${units[unit]}`;
}

/** Short label of an input for messages: its name, URL or MIME type. */
export function describeInput(input: { name?: string; url?: string; type?: string }): string {
  return input.name ?? input.url ?? (input.type ? `${input.type} input` : "the input");
}
