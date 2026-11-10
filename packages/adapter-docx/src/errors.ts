/** Machine-readable reasons a DOCX file cannot be shown. */
export type DocxErrorCode =
  /** Not a ZIP package, or a ZIP without a Word main document. */
  | "not-docx"
  /** Password protected (an encrypted OLE package). */
  | "encrypted"
  /** A Word 97-2003 binary file with a .docx name. */
  | "legacy-doc"
  /** The package exceeds the size, entry or compression-ratio limits. */
  | "too-large"
  /** The package structure is broken. */
  | "corrupt"
  /** XML parts use DTD/entity declarations or nest deeper than allowed (never written by Word). */
  | "unsafe"
  /** Both renderers failed. */
  | "render-failed";

const HINTS: Record<DocxErrorCode, string> = {
  "not-docx": "The file is not a Word document (.docx).",
  encrypted: "The document is password protected. Remove the password in Word and save it again.",
  "legacy-doc": "The file is a Word 97-2003 document. Open it as a .doc file.",
  "too-large": "The document is too large to open here.",
  corrupt: "The document is damaged.",
  unsafe:
    "The document contains XML features that are not allowed here (DTD or entity declarations, or extreme nesting).",
  "render-failed": "The document could not be rendered.",
};

/** Error thrown by the DOCX adapter; `code` is stable, `message` is English for logs and UI fallback. */
export class DocxError extends Error {
  readonly code: DocxErrorCode;

  constructor(code: DocxErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${HINTS[code]} (${detail})` : HINTS[code], options);
    this.name = "DocxError";
    this.code = code;
  }
}
