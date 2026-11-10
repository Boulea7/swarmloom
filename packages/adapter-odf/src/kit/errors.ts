/**
 * Machine-readable reason of a {@link DocumentError}. UIs translate through i18n keys `error.<code>`
 * and fall back to the English message.
 */
export type DocumentErrorCode =
  /** The bytes are not a valid document of the format (bad container, broken XML, unbalanced groups). */
  | "malformed"
  /** The document or one of its parts is encrypted or DRM-protected. */
  | "encrypted"
  /** The document is valid but uses a variant this adapter does not read. */
  | "unsupported"
  /** The input or one of its parts exceeds a safety limit (size, entry count, compression ratio, depth). */
  | "too-large"
  /** The input has no content. */
  | "empty";

/** Error thrown by the document adapters for problems with the input itself. */
export class DocumentError extends Error {
  override readonly name = "DocumentError";
  readonly code: DocumentErrorCode;
  /** Adapter id ("epub", "odf", "rtf", "ofd"). */
  readonly format: string;

  constructor(format: string, code: DocumentErrorCode, message: string, options?: { cause?: unknown }) {
    super(`${format}: ${message}`, options?.cause === undefined ? undefined : { cause: options.cause });
    this.format = format;
    this.code = code;
  }
}
