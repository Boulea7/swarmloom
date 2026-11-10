/**
 * What a file with a .doc name actually contains, from its first bytes (decisions-v1 F02). Word and
 * other tools save several formats under that extension: RTF, web pages (HTML / MHTML), Word 2003 XML
 * and, after a rename, Word 2007+ packages.
 */
export type DocContainer =
  /** OLE compound file: Word 97-2003 (or Word 6/95, or another Office application). */
  | "cfb"
  /** ZIP package: normally a renamed .docx. */
  | "zip"
  /** Rich Text Format. */
  | "rtf"
  /** A web page saved by Word ("Save as Web Page" with a .doc name). */
  | "html"
  /** Single-file web page (MIME HTML). */
  | "mhtml"
  /** Word 2003 XML (WordprocessingML 2003). */
  | "wordml"
  /** Word for Windows 1.x/2.x binary format (not a compound file). */
  | "word2"
  /** Word for DOS or Windows Write. */
  | "word-dos"
  | "unknown";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const HEAD_BYTES = 2048;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

/** The first bytes as text (UTF-16 or Latin-1, which keeps ASCII markers intact), without BOM or leading blanks. */
function headText(bytes: Uint8Array): string {
  const head = bytes.subarray(0, HEAD_BYTES);
  let text: string;
  if (head[0] === 0xff && head[1] === 0xfe) text = new TextDecoder("utf-16le").decode(head.subarray(2));
  else if (head[0] === 0xfe && head[1] === 0xff) text = new TextDecoder("utf-16be").decode(head.subarray(2));
  else {
    const start = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
    text = Array.from(head.subarray(start), (b) => String.fromCharCode(b)).join("");
  }
  return text.trimStart().toLowerCase();
}

/** Classifies the content of a .doc file by its magic bytes and leading text. */
export function detectDocContainer(bytes: Uint8Array): DocContainer {
  if (startsWith(bytes, CFB_MAGIC)) return "cfb";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  // wIdent 0xA5DB (Word 2.x) and 0xA59B (Word 1.x), little-endian.
  if (startsWith(bytes, [0xdb, 0xa5]) || startsWith(bytes, [0x9b, 0xa5])) return "word2";
  if (startsWith(bytes, [0x31, 0xbe, 0x00, 0x00]) || startsWith(bytes, [0x32, 0xbe, 0x00, 0x00])) return "word-dos";
  const text = headText(bytes);
  if (text.startsWith("{\\rtf")) return "rtf";
  if (/^(?:[a-z][\w-]*:[^\n]*\r?\n)*mime-version\s*:/.test(text)) return "mhtml";
  // Skip an XML declaration, doctype, processing instructions and comments before the root element.
  const body = text.replace(/^(?:<\?[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)*/, "");
  if (/^<w:worddocument[\s>]/.test(body) || (text.startsWith("<?xml") && text.includes("<w:worddocument"))) {
    return "wordml";
  }
  if (/^<(?:html|head|body|meta|title)[\s>]/.test(body) || text.startsWith("<!doctype html")) return "html";
  return "unknown";
}
