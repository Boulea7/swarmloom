/** Machine-readable reasons a Word 97-2003 file cannot be read. */
export type DocErrorCode =
  /** Not an OLE compound file (wrong magic bytes or a broken container). */
  | "not-cfb"
  /** A compound file without a `WordDocument` stream (Excel, PowerPoint, ...). */
  | "not-word"
  /** Password protected or XOR obfuscated. */
  | "encrypted"
  /** Word 6/95 or older binary layout, or an unknown FIB revision. */
  | "unsupported-version"
  /** Structures point outside their streams or contradict each other. */
  | "corrupt"
  /** Input exceeds the size limits. */
  | "too-large"
  /** No bytes to read. */
  | "no-input"
  /** A different format saved with a .doc name (RTF, web page, Word 2003 XML); see `DocError.format`. */
  | "wrong-format";

const HINTS: Record<DocErrorCode, string> = {
  "not-cfb": "The file is not a Word 97-2003 document.",
  "not-word": "The file is an Office file but not a Word document.",
  encrypted: "The document is password protected. Remove the password in Word and save it again.",
  "unsupported-version":
    "Only Word 97-2003 documents are supported. Open the file in Word or LibreOffice and save it as .docx.",
  corrupt: "The document is damaged or uses a layout this reader does not understand.",
  "too-large": "The document is too large to open here.",
  "no-input": "No document data was provided.",
  "wrong-format": "The file has a .doc name but is not a Word 97-2003 document.",
};

/** Error thrown by the DOC parser and adapter; `code` is stable, `message` is English for logs and UI fallback. */
export class DocError extends Error {
  readonly code: DocErrorCode;
  /** For "wrong-format": what the file really is ("rtf", "html", "mhtml", "wordml"), so callers can reroute it. */
  readonly format?: string;

  constructor(code: DocErrorCode, detail?: string, options?: { cause?: unknown; format?: string }) {
    super(detail ? `${HINTS[code]} (${detail})` : HINTS[code], options);
    this.name = "DocError";
    this.code = code;
    if (options?.format) this.format = options.format;
  }
}

/** Shorthand for a structural inconsistency in the file. */
export function corrupt(detail: string): DocError {
  return new DocError("corrupt", detail);
}
