import { DocumentError, sniffImage } from "@swarmloom/adapter-odf/kit";
import { charsetCodepage, decodeCodepage, decodeSymbol, SYMBOL_CHARSET } from "./codepage";
import type { RtfBlock, RtfCell, RtfCharStyle, RtfDocument, RtfFont, RtfParagraph, RtfRow, RtfRun } from "./model";

const FORMAT = "rtf";

/** Limits of {@link parseRtf}. */
export interface RtfParseOptions {
  /** Deepest group nesting. Default 1024. */
  maxDepth?: number;
  /** Largest picture (decoded bytes). Default 16 MiB. */
  maxPictureBytes?: number;
  /** Most pictures kept. Default 64. */
  maxPictures?: number;
}

type Dest = "body" | "skip" | "fonttbl" | "colortbl" | "info" | "title" | "author" | "pict";

interface CharState {
  font: number;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: number;
  background: number;
  vertical: 0 | 1 | -1;
  caps: 0 | 1 | 2;
  hidden: boolean;
}

interface ParaState {
  align: RtfParagraph["align"];
  li: number;
  ri: number;
  fi: number;
  sb: number;
  sa: number;
  sl: number;
  slmult: boolean;
  intbl: boolean;
  pagebb: boolean;
}

interface Group {
  dest: Dest;
  char: CharState;
  para: ParaState;
  uc: number;
  /** Destination restored by `\ud` inside `\upr`. */
  resume?: Dest;
}

interface CellDef {
  right: number;
  background?: number;
  verticalMerge?: "first" | "continue";
  mergedLeft?: boolean;
}

interface PictState {
  format: string;
  bytes: Uint8Array;
  length: number;
  nibble: number;
  picw?: number;
  pich?: number;
  goalw?: number;
  goalh?: number;
  scalex: number;
  scaley: number;
  tooBig: boolean;
}

/** Destinations whose content is never shown. */
const SKIP = new Set([
  "filetbl",
  "stylesheet",
  "listtable",
  "listoverridetable",
  "revtbl",
  "rsidtbl",
  "pgdsctbl",
  "generator",
  "xmlnstbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "mmathPr",
  "userprops",
  "docvar",
  "template",
  "fldinst",
  "nonshppict",
  "objdata",
  "objclass",
  "objname",
  "objalias",
  "objsect",
  "bkmkstart",
  "bkmkend",
  "xe",
  "tc",
  "txe",
  "rxe",
  "pn",
  "pntxta",
  "pntxtb",
  "picprop",
  "blipuid",
  "nesttableprops",
  "listpicture",
  "wgrffmtfilter",
  "ftnsep",
  "ftnsepc",
  "ftncn",
  "aftnsep",
  "aftnsepc",
  "aftncn",
  "atnid",
  "atnauthor",
  "atnref",
  "atrfstart",
  "atrfend",
  "atndate",
  "atnicn",
  "atnparent",
  "falt",
  "panose",
  "fname",
  "fontemb",
  "fontfile",
  "keycode",
  "subject",
  "operator",
  "keywords",
  "comment",
  "doccomm",
  "hlinkbase",
  "company",
  "category",
  "manager",
  "creatim",
  "revtim",
  "printim",
  "buptim",
  "shpinst",
  "shptxt",
  "sp",
  "sn",
  "sv",
  "protusertbl",
  "ud",
  "oldcprops",
  "oldpprops",
  "oldtprops",
  "oldsprops",
  "background",
  "pnseclvl",
]);
const HEADERS = new Set(["header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf"]);
const NOTES = new Set(["footnote", "annotation"]);
const PICT_FORMATS: Record<string, string> = {
  pngblip: "png",
  jpegblip: "jpeg",
  emfblip: "emf",
  wmetafile: "wmf",
  pmmetafile: "pmf",
  macpict: "pict",
  dibitmap: "dib",
  wbitmap: "bmp",
};
const SPECIAL: Record<string, string> = {
  emdash: "\u2014",
  endash: "\u2013",
  bullet: "\u2022",
  lquote: "\u2018",
  rquote: "\u2019",
  ldblquote: "\u201C",
  rdblquote: "\u201D",
  emspace: "\u2003",
  enspace: "\u2002",
  qmspace: "\u2005",
  zwj: "\u200D",
  zwnj: "\u200C",
  zwbo: "\u200B",
  ltrmark: "\u200E",
  rtlmark: "\u200F",
};

const plainChar = (font: number): CharState => ({
  font,
  size: 24,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: 0,
  background: 0,
  vertical: 0,
  caps: 0,
  hidden: false,
});

const plainPara = (): ParaState => ({
  align: "left",
  li: 0,
  ri: 0,
  fi: 0,
  sb: 0,
  sa: 0,
  sl: 0,
  slmult: false,
  intbl: false,
  pagebb: false,
});

const isLetter = (c: number) => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const hexValue = (c: number) =>
  isDigit(c) ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1;

/** Offset of `{\rtf` after optional whitespace and a UTF-8 BOM, or -1. */
export function rtfStart(bytes: Uint8Array): number {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (
    i < bytes.length &&
    i < 64 &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  )
    i++;
  const head = "{\\rtf";
  for (let k = 0; k < head.length; k++) if (bytes[i + k] !== head.charCodeAt(k)) return -1;
  return i;
}

/** True when `head` starts like an RTF document (`{\rtf`). */
export function sniffRtf(head: Uint8Array): boolean {
  return rtfStart(head) >= 0;
}

/**
 * Parses an RTF document into blocks of paragraphs, tables and page breaks.
 *
 * Covers groups and control words, `\u` with the `\uc` skip count, `\'hh` bytes decoded with the
 * code page of the run's font (`\fcharset`, `\cpg`) or of the document (`\ansicpg`, including 936
 * GBK and 950 Big5), the font and colour tables, character formatting (`\b \i \ul \strike \fs \f
 * \cf \highlight \super \sub \caps`), paragraph formatting (`\pard \q* \li \ri \fi \sb \sa \sl`),
 * `\par \line \tab \page`, tables (`\trowd \cellx \clcbpat \cell \row`, merges) and PNG/JPEG
 * pictures (`\pict`, hex or `\bin`). Unknown `{\*...}` destinations are skipped.
 *
 * @throws DocumentError `malformed` when the input is not RTF or its groups are unbalanced.
 */
export function parseRtf(bytes: Uint8Array, options: RtfParseOptions = {}): RtfDocument {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("rtf: parseRtf expects a Uint8Array");
  const start = rtfStart(bytes);
  if (start < 0) throw new DocumentError(FORMAT, "malformed", "not an RTF document (it must start with {\\rtf)");
  const maxDepth = options.maxDepth ?? 1024;
  const maxPictureBytes = options.maxPictureBytes ?? 16 * 1024 * 1024;
  const maxPictures = options.maxPictures ?? 64;

  const doc: RtfDocument = {
    codepage: 1252,
    defaultTab: 720,
    page: { width: 12240, height: 15840, top: 1440, right: 1800, bottom: 1440, left: 1800 },
    fonts: new Map(),
    colors: [],
    blocks: [],
    stats: { headers: 0, footnotes: 0, unsupportedPictures: 0, droppedPictures: 0, nestedTables: 0 },
  };
  let deff = -1;
  let pictures = 0;
  const pageSet = new Set<string>();

  const stack: Group[] = [];
  let g: Group = { dest: "body", char: plainChar(-1), para: plainPara(), uc: 1 };
  let pendingSkip = 0;
  let ignorable = false;

  // Text being collected: raw bytes (decoded in one go so double-byte characters stay whole) and text.
  let rawBytes: number[] = [];
  let pendingText = "";
  let titleText = "";
  let authorText = "";

  // Font table entry being read.
  let font: { id: number; charset: number; codepage?: number; generic?: RtfFont["generic"]; name: string } | null =
    null;
  // Colour table entry being read.
  let rgb: [number, number, number] | null = null;

  // Body.
  let runs: RtfRun[] = [];
  let cellParas: RtfParagraph[] = [];
  let rowCells: RtfParagraph[][] = [];
  let rowDef: { left: number; bordered: boolean; cells: CellDef[]; next: CellDef } = {
    left: 0,
    bordered: false,
    cells: [],
    next: { right: 0 },
  };
  let pendingBorder = false;
  let sectionBreak = false;
  let pict: PictState | null = null;

  const decode = (raw: Uint8Array, fontId: number): string => {
    const f = doc.fonts.get(fontId);
    return f?.charset === SYMBOL_CHARSET ? decodeSymbol(raw) : decodeCodepage(raw, f ? f.codepage : doc.codepage);
  };
  const fontCodepageOf = (entry: NonNullable<typeof font>) =>
    entry.codepage ?? charsetCodepage(entry.charset) ?? doc.codepage;

  const flushBytes = () => {
    if (rawBytes.length === 0) return;
    const raw = Uint8Array.from(rawBytes);
    rawBytes = [];
    // Font names are encoded in the code page of the font being declared.
    if (g.dest === "fonttbl" && font)
      collect(font.charset === SYMBOL_CHARSET ? decodeSymbol(raw) : decodeCodepage(raw, fontCodepageOf(font)));
    else collect(decode(raw, g.char.font));
  };

  /** Routes decoded text to the current destination. */
  const collect = (text: string) => {
    switch (g.dest) {
      case "body":
        if (!g.char.hidden) pendingText += text;
        break;
      case "title":
        titleText += text;
        break;
      case "author":
        authorText += text;
        break;
      case "fonttbl":
        if (font) font.name += text;
        break;
      default:
        break;
    }
  };

  const charStyle = (): RtfCharStyle => {
    const c = g.char;
    const style: RtfCharStyle = {
      bold: c.bold,
      italic: c.italic,
      underline: c.underline,
      strike: c.strike,
      size: c.size,
    };
    const f = doc.fonts.get(c.font);
    if (f) style.font = f;
    const color = c.color > 0 ? doc.colors[c.color] : undefined;
    if (color) style.color = color;
    const background = c.background > 0 ? doc.colors[c.background] : undefined;
    if (background) style.background = background;
    if (c.vertical) style.vertical = c.vertical > 0 ? "super" : "sub";
    if (c.caps) style.caps = c.caps === 1 ? "all" : "small";
    return style;
  };

  /** Ends the current text run (before any formatting change). */
  const flush = () => {
    flushBytes();
    if (pendingText && g.dest === "body") runs.push({ type: "text", text: pendingText, style: charStyle() });
    pendingText = "";
  };

  const commitFont = () => {
    if (!font) return;
    flushBytes();
    const name = font.name.replace(/;\s*$/, "").trim();
    const entry: RtfFont = { id: font.id, name, charset: font.charset, codepage: fontCodepageOf(font) };
    if (font.generic) entry.generic = font.generic;
    doc.fonts.set(font.id, entry);
    font = null;
  };

  const blocks = doc.blocks;
  const lastBlock = () => blocks[blocks.length - 1];
  const pushBlock = (block: RtfBlock) => {
    if (sectionBreak) {
      sectionBreak = false;
      pageBreak();
    }
    blocks.push(block);
  };
  const pageBreak = () => {
    const last = lastBlock();
    if (last && last.type !== "page-break") blocks.push({ type: "page-break" });
  };

  const paragraph = (): RtfParagraph => {
    const p = g.para;
    const out: RtfParagraph = {
      type: "paragraph",
      align: p.align,
      leftIndent: p.li,
      rightIndent: p.ri,
      firstIndent: p.fi,
      spaceBefore: p.sb,
      spaceAfter: p.sa,
      markSize: g.char.size,
      runs,
    };
    if (p.sl !== 0) {
      out.lineSpacing = p.sl;
      if (p.slmult) out.lineMultiple = true;
    }
    runs = [];
    return out;
  };

  const endRow = () => {
    flush();
    if (runs.length > 0) cellParas.push(paragraph());
    if (cellParas.length > 0) {
      rowCells.push(cellParas);
      cellParas = [];
    }
    if (rowCells.length === 0) return;
    let prev = rowDef.left;
    const cells: RtfCell[] = rowCells.map((paragraphs, i) => {
      const def = rowDef.cells[i];
      const right = def && def.right > prev ? def.right : prev + 1440;
      prev = right;
      const cell: RtfCell = { right, paragraphs };
      const background = def?.background ? doc.colors[def.background] : undefined;
      if (background) cell.background = background;
      if (def?.verticalMerge) cell.verticalMerge = def.verticalMerge;
      if (def?.mergedLeft) cell.mergedLeft = true;
      return cell;
    });
    rowCells = [];
    const row: RtfRow = { left: rowDef.left, bordered: rowDef.bordered, cells };
    const last = lastBlock();
    if (last?.type === "table") last.rows.push(row);
    else pushBlock({ type: "table", rows: [row] });
  };

  const endParagraph = () => {
    flush();
    if (g.para.intbl) {
      cellParas.push(paragraph());
      return;
    }
    if (rowCells.length > 0 || cellParas.length > 0) endRow();
    const p = paragraph();
    if (g.para.pagebb) pageBreak();
    pushBlock(p);
  };

  const endCell = () => {
    flush();
    if (runs.length > 0 || cellParas.length === 0) cellParas.push(paragraph());
    rowCells.push(cellParas);
    cellParas = [];
  };

  const addPictByte = (b: number) => {
    if (!pict || pict.tooBig) return;
    if (pict.length >= maxPictureBytes) {
      pict.tooBig = true;
      return;
    }
    if (pict.length === pict.bytes.length) {
      const grown = new Uint8Array(Math.min(maxPictureBytes, Math.max(4096, pict.bytes.length * 2)));
      grown.set(pict.bytes);
      pict.bytes = grown;
    }
    pict.bytes[pict.length++] = b;
  };

  const finishPict = () => {
    const p = pict;
    pict = null;
    if (!p) return;
    const scale = (v: number | undefined, s: number) => (v === undefined ? undefined : Math.round((v * s) / 100));
    const bitmap = p.format === "png" || p.format === "jpeg" || p.format === "bmp" || p.format === "dib";
    // \picw/\pich are pixels for bitmaps and 0.01 mm for metafiles; goals are twips.
    const w = p.goalw ?? (p.picw === undefined ? undefined : bitmap ? p.picw * 15 : Math.round((p.picw * 1440) / 2540));
    const h = p.goalh ?? (p.pich === undefined ? undefined : bitmap ? p.pich * 15 : Math.round((p.pich * 1440) / 2540));
    const size: { width?: number; height?: number } = {};
    const sw = scale(w, p.scalex);
    const sh = scale(h, p.scaley);
    if (sw && sw > 0) size.width = sw;
    if (sh && sh > 0) size.height = sh;
    const data = p.bytes.slice(0, p.length);
    const mime = sniffImage(data);
    if (p.tooBig || pictures >= maxPictures) {
      doc.stats.droppedPictures++;
      runs.push({ type: "unsupported-image", format: p.format, ...size });
    } else if ((p.format === "png" || p.format === "jpeg") && (mime === "image/png" || mime === "image/jpeg")) {
      pictures++;
      runs.push({ type: "image", mime, bytes: data, ...size });
    } else {
      doc.stats.unsupportedPictures++;
      runs.push({ type: "unsupported-image", format: p.format, ...size });
    }
  };

  const setPage = (key: string, value: number) => {
    // Section-level values (\pgwsxn ...) only apply when the document did not set its own.
    if (value <= 0 || value > 31680) return;
    if (key.endsWith("sxn")) {
      const base = key.replace(/sxn$/, "");
      if (pageSet.has(base)) return;
      key = base;
    }
    pageSet.add(key);
    const page = doc.page;
    if (key === "paperw" || key === "pgw") page.width = value;
    else if (key === "paperh" || key === "pgh") page.height = value;
    else if (key === "margl") page.left = value;
    else if (key === "margr") page.right = value;
    else if (key === "margt") page.top = value;
    else if (key === "margb") page.bottom = value;
  };

  /** Handles a destination word; returns true when it was one. */
  const destination = (word: string): boolean => {
    if (word === "fonttbl") g.dest = "fonttbl";
    else if (word === "colortbl") g.dest = "colortbl";
    else if (word === "info") g.dest = "info";
    else if ((word === "title" || word === "author") && g.dest === "info") g.dest = word;
    else if (word === "pict") {
      g.dest = "pict";
      pict = {
        format: "unknown",
        bytes: new Uint8Array(0),
        length: 0,
        nibble: -1,
        scalex: 100,
        scaley: 100,
        tooBig: false,
      };
    } else if (word === "upr") {
      g.resume = g.dest;
      g.dest = "skip";
    } else if (HEADERS.has(word)) {
      doc.stats.headers++;
      g.dest = "skip";
    } else if (NOTES.has(word)) {
      doc.stats.footnotes++;
      g.dest = "skip";
    } else if (SKIP.has(word) || (g.dest === "info" && word !== "title" && word !== "author")) g.dest = "skip";
    else return false;
    return true;
  };

  const controlWord = (word: string, param: number | null) => {
    if (pendingSkip > 0) {
      pendingSkip--;
      return;
    }
    const star = ignorable;
    ignorable = false;
    if (g.dest === "skip") {
      // \ud inside \upr brings back the Unicode version of the text.
      if (word === "ud" && g.resume !== undefined) g.dest = g.resume;
      return;
    }
    if (star) {
      if (word === "shppict" || word === "fldrslt") return;
      if (word === "ud") {
        g.dest = g.resume ?? g.dest;
        return;
      }
      flush();
      // Unknown (and most known) ignorable destinations are skipped; the call only counts them.
      if (word !== "pict") destination(word);
      g.dest = "skip";
      return;
    }
    if (word === "u") {
      // \uN works in every text destination (body, font names, title); N is signed 16-bit.
      flushBytes();
      const value = param ?? 0;
      const code = value < 0 ? value + 65536 : value;
      if (code >= 0 && code <= 0xffff) collect(String.fromCharCode(code));
      pendingSkip = g.uc;
      return;
    }
    if (word === "uc") {
      g.uc = Math.max(0, Math.min(16, param ?? 1));
      return;
    }
    const n = param ?? 0;
    const on = param === null || param !== 0;
    if (g.dest === "pict" && pict) {
      const fmt = PICT_FORMATS[word];
      if (fmt) pict.format = fmt;
      else if (word === "picw") pict.picw = n;
      else if (word === "pich") pict.pich = n;
      else if (word === "picwgoal") pict.goalw = n;
      else if (word === "pichgoal") pict.goalh = n;
      else if (word === "picscalex" && n > 0) pict.scalex = n;
      else if (word === "picscaley" && n > 0) pict.scaley = n;
      else destination(word);
      return;
    }
    if (g.dest === "colortbl") {
      rgb ??= [0, 0, 0];
      if (word === "red") rgb[0] = Math.min(255, Math.max(0, n));
      else if (word === "green") rgb[1] = Math.min(255, Math.max(0, n));
      else if (word === "blue") rgb[2] = Math.min(255, Math.max(0, n));
      return;
    }
    if (g.dest === "fonttbl") {
      if (word === "f") {
        commitFont();
        font = { id: n, charset: 0, name: "" };
      } else if (font) {
        flushBytes();
        if (word === "fcharset") font.charset = n;
        else if (word === "cpg" && n > 0) font.codepage = n;
        else if (word === "froman") font.generic = "serif";
        else if (word === "fswiss") font.generic = "sans-serif";
        else if (word === "fmodern") font.generic = "monospace";
        else destination(word);
      } else destination(word);
      return;
    }
    flush();
    if (destination(word)) return;
    const special = SPECIAL[word];
    if (special !== undefined) {
      collect(special);
      return;
    }
    const c = g.char;
    const p = g.para;
    switch (word) {
      case "ansi":
        doc.codepage = 1252;
        break;
      case "mac":
        doc.codepage = 10000;
        break;
      case "pc":
        doc.codepage = 437;
        break;
      case "pca":
        doc.codepage = 850;
        break;
      case "ansicpg":
        if (n > 0) doc.codepage = n;
        break;
      case "deff":
        deff = n;
        if (stack.length <= 1) g.char.font = n;
        break;
      case "deftab":
        if (n > 0 && n < 14400) doc.defaultTab = n;
        break;
      case "par":
      case "sect":
        if (g.dest === "body") endParagraph();
        if (word === "sect") sectionBreak = true;
        break;
      case "sbknone":
      case "sbkcol":
        sectionBreak = false;
        break;
      case "line":
        if (g.dest === "body") runs.push({ type: "break" });
        else collect(" ");
        break;
      case "tab":
        if (g.dest === "body") runs.push({ type: "tab" });
        else collect(" ");
        break;
      case "page":
        if (g.dest === "body") {
          if (runs.length > 0) endParagraph();
          if (!g.para.intbl) pageBreak();
        }
        break;
      case "plain":
        g.char = plainChar(deff);
        break;
      case "b":
        c.bold = on;
        break;
      case "i":
        c.italic = on;
        break;
      case "strike":
      case "striked":
        c.strike = on;
        break;
      case "ulnone":
        c.underline = false;
        break;
      case "fs":
        if (n > 0 && n <= 3276) c.size = n;
        break;
      case "f":
        c.font = n;
        break;
      case "cf":
        c.color = n;
        break;
      case "cb":
      case "highlight":
      case "chcbpat":
        c.background = n;
        break;
      case "super":
        c.vertical = 1;
        break;
      case "sub":
        c.vertical = -1;
        break;
      case "nosupersub":
        c.vertical = 0;
        break;
      case "caps":
        c.caps = on ? 1 : 0;
        break;
      case "scaps":
        c.caps = on ? 2 : 0;
        break;
      case "v":
        c.hidden = on;
        break;
      case "pard":
        g.para = plainPara();
        break;
      case "ql":
        p.align = "left";
        break;
      case "qc":
        p.align = "center";
        break;
      case "qr":
        p.align = "right";
        break;
      case "qj":
      case "qd":
        p.align = "justify";
        break;
      case "li":
      case "lin":
        p.li = n;
        break;
      case "ri":
      case "rin":
        p.ri = n;
        break;
      case "fi":
        p.fi = n;
        break;
      case "sb":
        p.sb = Math.max(0, n);
        break;
      case "sa":
        p.sa = Math.max(0, n);
        break;
      case "sl":
        p.sl = n;
        break;
      case "slmult":
        p.slmult = on;
        break;
      case "pagebb":
        p.pagebb = on;
        break;
      case "intbl":
        p.intbl = true;
        break;
      case "itap":
        p.intbl = n > 0;
        break;
      case "trowd":
        rowDef = { left: 0, bordered: false, cells: [], next: { right: 0 } };
        pendingBorder = false;
        break;
      case "trleft":
        rowDef.left = n;
        break;
      case "clcbpat":
        rowDef.next.background = n;
        break;
      case "clvmgf":
        rowDef.next.verticalMerge = "first";
        break;
      case "clvmrg":
        rowDef.next.verticalMerge = "continue";
        break;
      case "clmrg":
        rowDef.next.mergedLeft = true;
        break;
      case "cellx":
        rowDef.next.right = n;
        rowDef.cells.push(rowDef.next);
        rowDef.next = { right: 0 };
        break;
      case "cell":
        if (g.dest === "body") endCell();
        break;
      case "nestcell":
        if (g.dest === "body") {
          doc.stats.nestedTables = Math.max(doc.stats.nestedTables, 1);
          cellParas.push(paragraph());
        }
        break;
      case "nestrow":
        break;
      case "row":
        if (g.dest === "body") endRow();
        break;
      default:
        if (word.startsWith("ul") && word !== "ulc") c.underline = on;
        else if (/^(?:cl|tr)brdr[tlbrhv]$/.test(word)) pendingBorder = true;
        else if (/^brdr(?!none)/.test(word) && pendingBorder) rowDef.bordered = true;
        else if (word === "brdrnone") pendingBorder = false;
        else if (
          word === "paperw" ||
          word === "paperh" ||
          /^marg[lrtb](?:sxn)?$/.test(word) ||
          /^pg[wh]sxn$/.test(word)
        )
          setPage(word, n);
        else if (word === "landscape" && doc.page.width < doc.page.height) {
          const { width, height } = doc.page;
          doc.page.width = height;
          doc.page.height = width;
        }
        break;
    }
  };

  /** One text byte (literal or from \'hh). */
  const textByte = (b: number) => {
    if (pendingSkip > 0) {
      pendingSkip--;
      return;
    }
    switch (g.dest) {
      case "skip":
      case "info":
        return;
      case "pict": {
        if (!pict) return;
        const v = hexValue(b);
        if (v < 0) return;
        if (pict.nibble < 0) pict.nibble = v;
        else {
          addPictByte((pict.nibble << 4) | v);
          pict.nibble = -1;
        }
        return;
      }
      case "colortbl":
        if (b === 0x3b) {
          doc.colors.push(rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}` : undefined);
          rgb = null;
        }
        return;
      case "fonttbl":
        if (b === 0x3b) {
          commitFont();
          return;
        }
        if (font) rawBytes.push(b);
        return;
      default:
        if (g.dest === "body" && g.char.hidden) return;
        rawBytes.push(b);
    }
  };

  const n = bytes.length;
  let i = start;
  let closedAt = -1;
  while (i < n) {
    const c = bytes[i] as number;
    if (c === 0x7b) {
      flush();
      stack.push(g);
      if (stack.length > maxDepth)
        throw new DocumentError(FORMAT, "malformed", `groups are nested deeper than ${maxDepth} levels`);
      g = { ...g, char: { ...g.char }, para: { ...g.para } };
      pendingSkip = 0;
      i++;
      continue;
    }
    if (c === 0x7d) {
      flush();
      // Text after the last \par of the document is still a paragraph.
      if (stack.length === 1 && g.dest === "body" && runs.length > 0) endParagraph();
      const closing = g;
      const parent = stack.pop();
      if (!parent) throw new DocumentError(FORMAT, "malformed", "unbalanced groups: a '}' has no matching '{'");
      if (closing.dest === "fonttbl" && parent.dest !== "fonttbl") commitFont();
      g = parent;
      if (closing.dest === "pict" && parent.dest !== "pict") finishPict();
      pendingSkip = 0;
      ignorable = false;
      i++;
      if (stack.length === 0) {
        closedAt = i;
        break;
      }
      continue;
    }
    if (c === 0x5c) {
      i++;
      if (i >= n) break;
      const d = bytes[i] as number;
      if (isLetter(d)) {
        let s = i;
        while (i < n && isLetter(bytes[i] as number) && i - s < 32) i++;
        const word = String.fromCharCode(...bytes.subarray(s, i));
        let param: number | null = null;
        s = i;
        if (bytes[i] === 0x2d && isDigit(bytes[i + 1] ?? 0)) i++;
        while (i < n && isDigit(bytes[i] as number) && i - s < 11) i++;
        if (i > s) param = Number(String.fromCharCode(...bytes.subarray(s, i)));
        if (bytes[i] === 0x20) i++;
        if (word === "bin") {
          const len = Math.max(0, param ?? 0);
          if (i + len > n) throw new DocumentError(FORMAT, "malformed", "\\bin data runs past the end of the file");
          if (pendingSkip > 0) pendingSkip--;
          else if (g.dest === "pict") for (let k = 0; k < len; k++) addPictByte(bytes[i + k] as number);
          i += len;
          continue;
        }
        controlWord(word, param);
        continue;
      }
      i++;
      if (d === 0x27) {
        const hi = hexValue(bytes[i] ?? 0);
        const lo = hexValue(bytes[i + 1] ?? 0);
        if (hi >= 0 && lo >= 0) {
          i += 2;
          textByte((hi << 4) | lo);
        }
        continue;
      }
      if (d === 0x5c || d === 0x7b || d === 0x7d) {
        textByte(d);
        continue;
      }
      if (pendingSkip > 0 && d !== 0x2a) {
        pendingSkip--;
        continue;
      }
      if (d === 0x2a) ignorable = true;
      else if (d === 0x7e) {
        flushBytes();
        collect("\u00A0");
      } else if (d === 0x5f) {
        flushBytes();
        collect("\u2011");
      } else if (d === 0x0a || d === 0x0d) controlWord("par", null);
      else if (d === 0x09) controlWord("tab", null);
      continue;
    }
    if (c === 0x0a || c === 0x0d || (c === 0x00 && g.dest !== "pict")) {
      i++;
      continue;
    }
    if (c === 0x09 && g.dest === "body") {
      flush();
      runs.push({ type: "tab" });
      i++;
      continue;
    }
    textByte(c);
    i++;
  }
  if (closedAt < 0) {
    throw new DocumentError(
      FORMAT,
      "malformed",
      `unbalanced groups: ${Math.max(1, stack.length)} group(s) are not closed`,
    );
  }
  for (let k = closedAt; k < n; k++) {
    if (bytes[k] === 0x7d) throw new DocumentError(FORMAT, "malformed", "unbalanced groups: a '}' has no matching '{'");
  }
  if (rowCells.length > 0 || cellParas.length > 0) endRow();
  const title = titleText.replace(/\s+/g, " ").trim();
  const author = authorText.replace(/\s+/g, " ").trim();
  if (title) doc.title = title;
  if (author) doc.author = author;
  const def = doc.fonts.get(deff);
  if (def) doc.defaultFont = def;
  return doc;
}
