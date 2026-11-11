/**
 * Windows code pages and RTF character sets, mapped to WHATWG encoding labels for TextDecoder.
 */

const CODEPAGE_LABELS: Record<number, string> = {
  437: "windows-1252",
  708: "iso-8859-6",
  850: "windows-1252",
  866: "ibm866",
  874: "windows-874",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  1200: "utf-16le",
  1201: "utf-16be",
  1250: "windows-1250",
  1251: "windows-1251",
  1252: "windows-1252",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
  1361: "euc-kr",
  10000: "macintosh",
  10001: "shift_jis",
  10002: "big5",
  10003: "euc-kr",
  10008: "gbk",
  10007: "x-mac-cyrillic",
  20127: "windows-1252",
  20866: "koi8-r",
  20932: "euc-jp",
  20936: "gbk",
  21866: "koi8-u",
  28591: "windows-1252",
  28592: "iso-8859-2",
  28595: "iso-8859-5",
  28597: "iso-8859-7",
  28598: "iso-8859-8",
  50220: "iso-2022-jp",
  51932: "euc-jp",
  51936: "gbk",
  51949: "euc-kr",
  54936: "gb18030",
  65001: "utf-8",
};

/** `\fcharsetN` values and the code page each implies. 0 (ANSI) and 1 (default) use the document's. */
const CHARSET_CODEPAGES: Record<number, number> = {
  77: 10000,
  78: 10001,
  79: 10003,
  80: 10008,
  81: 10002,
  128: 932,
  129: 949,
  130: 1361,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
  254: 437,
  255: 850,
};

/** The symbol character set (Symbol, Wingdings): bytes are glyph positions, not text. */
export const SYMBOL_CHARSET = 2;

/** WHATWG encoding label of a Windows code page (unknown pages fall back to windows-1252). */
export function codepageLabel(codepage: number): string {
  return CODEPAGE_LABELS[codepage] ?? "windows-1252";
}

/** Code page implied by an RTF `\fcharset`, or undefined for ANSI/default/symbol. */
export function charsetCodepage(charset: number): number | undefined {
  return CHARSET_CODEPAGES[charset];
}

const decoders = new Map<string, TextDecoder>();

/** Decodes bytes with a Windows code page (cached decoders, replacement on errors). */
export function decodeCodepage(bytes: Uint8Array, codepage: number): string {
  const label = codepageLabel(codepage);
  let decoder = decoders.get(label);
  if (!decoder) {
    try {
      decoder = new TextDecoder(label);
    } catch {
      decoder = new TextDecoder("windows-1252");
    }
    decoders.set(label, decoder);
  }
  return decoder.decode(bytes);
}

/** Common Symbol and Wingdings glyphs used for list bullets. Other bytes keep their Latin-1 value. */
const SYMBOL_GLYPHS: Record<number, string> = {
  108: "\u25CF",
  110: "\u25A0",
  111: "\u25A1",
  113: "\u2751",
  118: "\u2756",
  167: "\u25AA",
  168: "\u25C6",
  183: "\u2022",
  216: "\u27A2",
  252: "\u2713",
};

/** Text for bytes of a symbol-charset font. */
export function decodeSymbol(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += SYMBOL_GLYPHS[b] ?? String.fromCharCode(b);
  return out;
}
