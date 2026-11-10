/** Error type of the PDF adapter, with a stable code the UI can map to a message. */

export type PdfErrorCode =
  /** No bytes or URL, fetch failed, or not a PDF. */
  | "input"
  /** File larger than `maxBytes`. */
  | "too-large"
  /** pdf.js could not parse the file. */
  | "invalid"
  /** Encrypted and no (or a wrong) password. */
  | "password"
  /** The first page failed to render. */
  | "render";

export class PdfAdapterError extends Error {
  override readonly name = "PdfAdapterError";
  readonly code: PdfErrorCode;

  constructor(code: PdfErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** The rejection value of an aborted load, matching `fetch` and `AbortSignal.throwIfAborted()`. */
export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The PDF load was aborted", "AbortError");
}

/** Maps pdf.js exceptions (matched by name, they are plain classes) to adapter errors; passes others through. */
export function fromPdfJs(error: unknown): unknown {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "PasswordException") {
    return new PdfAdapterError("password", "This PDF is password-protected; pass the password option to open it", {
      cause: error,
    });
  }
  if (name === "InvalidPDFException" || name === "FormatError" || name === "UnknownErrorException") {
    return new PdfAdapterError("invalid", "This file could not be read as a PDF", { cause: error });
  }
  return error;
}
