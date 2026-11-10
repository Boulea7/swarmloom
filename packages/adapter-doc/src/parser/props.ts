import { argI16, argI32, argU8, argU16, type Sprm } from "./sprm";

/** Character formatting recovered from CHPX sprms. Sizes in half-points. */
export interface CharProps {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  caps: boolean;
  smallCaps: boolean;
  /** Hidden text (not displayed). */
  hidden: boolean;
  /** Deleted revision: kept in the file, not displayed. */
  deleted: boolean;
  /** The run holds special characters (pictures, note references, fields). */
  special: boolean;
  /** Half-points. */
  size: number;
  /** CSS colour, or null for automatic. */
  color: string | null;
  highlight: string | null;
  /** Index into the font table for ASCII text. */
  font: number;
  /** Index into the font table for East Asian text. */
  fontEastAsia: number;
  vertAlign: "baseline" | "super" | "sub";
  /** Data stream offset of an inline picture (sprmCPicLocation), or -1. */
  picture: number;
  /** The picture is an embedded OLE object rather than an image. */
  ole: boolean;
}

export type Align = "left" | "center" | "right" | "justify";

/** Twips (1/20 pt) unless noted. */
export interface ParaProps {
  align: Align;
  indentLeft: number;
  indentRight: number;
  /** First-line indent; negative is a hanging indent. */
  indentFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  /** Line spacing: a multiple (240 = single) or an exact/at-least height in twips. */
  line: { value: number; multiple: boolean } | null;
  inTable: boolean;
  /** Table terminating paragraph: the row-end mark. */
  rowEnd: boolean;
  /** Table nesting depth (0 outside tables). */
  depth: number;
  /** Outline level 0..8, or 9 for body text. */
  outline: number;
  /** 1-based list format override index; 0 = not a list paragraph. */
  list: number;
  listLevel: number;
  pageBreakBefore: boolean;
  /** Suppress spacing between consecutive paragraphs of the same style. */
  contextual: boolean;
  shading: string | null;
  /** Column right edges in twips from sprmTDefTable (row-end paragraphs only). */
  columns: number[] | null;
  /** Table borders: true when the row draws cell borders, null when unknown. */
  borders: boolean | null;
}

export function defaultCharProps(): CharProps {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    caps: false,
    smallCaps: false,
    hidden: false,
    deleted: false,
    special: false,
    size: 20,
    color: null,
    highlight: null,
    font: 0,
    fontEastAsia: 0,
    vertAlign: "baseline",
    picture: -1,
    ole: false,
  };
}

export function defaultParaProps(): ParaProps {
  return {
    align: "left",
    indentLeft: 0,
    indentRight: 0,
    indentFirst: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    line: null,
    inTable: false,
    rowEnd: false,
    depth: 0,
    outline: 9,
    list: 0,
    listLevel: 0,
    pageBreakBefore: false,
    contextual: false,
    shading: null,
    columns: null,
    borders: null,
  };
}

/** The 16 legacy colour indexes (ico) used by sprmCIco and highlights. */
const ICO = [
  null,
  "#000000",
  "#0000ff",
  "#00ffff",
  "#00ff00",
  "#ff00ff",
  "#ff0000",
  "#ffff00",
  "#ffffff",
  "#000080",
  "#008080",
  "#008000",
  "#800080",
  "#800000",
  "#808000",
  "#808080",
  "#c0c0c0",
] as const;

function ico(index: number): string | null {
  return ICO[index] ?? null;
}

function hex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** COLORREF (r, g, b, fAuto); fAuto 0xFF means automatic. */
function colorRef(s: Sprm, offset = 0): string | null {
  if (argU8(s, offset + 3) === 0xff) return null;
  return `#${hex(argU8(s, offset))}${hex(argU8(s, offset + 1))}${hex(argU8(s, offset + 2))}`;
}

/** ToggleOperand: 0 off, 1 on, 0x80 = value of the style, 0x81 = opposite of the style. */
function toggle(value: number, styleValue: boolean): boolean {
  if (value === 0x80) return styleValue;
  if (value === 0x81) return !styleValue;
  return value !== 0;
}

type ToggleKey = "bold" | "italic" | "strike" | "caps" | "smallCaps" | "hidden";

const TOGGLES: Record<number, ToggleKey> = {
  2101: "bold",
  2102: "italic",
  2103: "strike",
  2107: "caps",
  2106: "smallCaps",
  2108: "hidden",
};

export const SPRM_C_ISTD = 0x4a30;

/**
 * Applies one character sprm to `props` in place. `style` is the formatting the toggles refer to
 * (the paragraph/character style before direct formatting).
 */
export function applyCharSprm(props: CharProps, s: Sprm, style: CharProps): void {
  const key = TOGGLES[s.op];
  if (key) {
    props[key] = toggle(argU8(s), style[key]);
    return;
  }
  switch (s.op) {
    case 0x0800:
      props.deleted = argU8(s) !== 0;
      break;
    case 0x0855:
      props.special = argU8(s) !== 0;
      break;
    case 0x080a:
      props.ole = argU8(s) !== 0;
      break;
    case 0x2a3e:
      props.underline = argU8(s) !== 0;
      break;
    case 0x2a53:
      props.strike = argU8(s) !== 0 || props.strike;
      break;
    case 0x4a43:
      if (argU16(s) > 0) props.size = argU16(s);
      break;
    case 0x2a42:
      props.color = ico(argU8(s));
      break;
    case 0x6870:
      props.color = colorRef(s);
      break;
    case 0x2a0c:
      props.highlight = ico(argU8(s));
      break;
    case 0x4a4f:
      props.font = argU16(s);
      break;
    case 0x4a50:
      props.fontEastAsia = argU16(s);
      break;
    case 0x2a48: {
      const iss = argU8(s);
      props.vertAlign = iss === 1 ? "super" : iss === 2 ? "sub" : "baseline";
      break;
    }
    case 0x6a03:
      props.picture = argI32(s);
      break;
  }
}

const JC: readonly Align[] = ["left", "center", "right", "justify", "justify"];

/** Applies one paragraph or table sprm to `props` in place. */
export function applyParaSprm(props: ParaProps, s: Sprm): void {
  switch (s.op) {
    case 0x2403:
    case 0x2461:
      props.align = JC[argU8(s)] ?? "left";
      break;
    case 0x840f:
    case 0x845e:
      props.indentLeft = argI16(s);
      break;
    case 0x840e:
    case 0x845d:
      props.indentRight = argI16(s);
      break;
    case 0x8411:
    case 0x8460:
      props.indentFirst = argI16(s);
      break;
    case 0xa413:
      props.spaceBefore = argU16(s);
      break;
    case 0xa414:
      props.spaceAfter = argU16(s);
      break;
    case 0x6412:
      props.line = { value: argI16(s), multiple: argI16(s, 2) === 1 };
      break;
    case 0x2416:
      props.inTable = argU8(s) !== 0;
      if (props.inTable && props.depth === 0) props.depth = 1;
      break;
    case 0x2417:
      props.rowEnd = argU8(s) !== 0;
      break;
    case 0x6649:
      props.depth = Math.max(0, argI32(s));
      break;
    case 0x664a:
      props.depth = Math.max(0, props.depth + argI32(s));
      break;
    case 0x2640:
      props.outline = argU8(s);
      break;
    case 0x460b:
      props.list = Math.max(0, argI16(s));
      break;
    case 0x260a:
      props.listLevel = Math.min(8, argU8(s));
      break;
    case 0x2407:
      props.pageBreakBefore = argU8(s) !== 0;
      break;
    case 0x246d:
      props.contextual = argU8(s) !== 0;
      break;
    case 0x442d: {
      // Shd80: icoFore (5 bits), icoBack (5 bits), ipat (6 bits); ipat 1 = solid foreground.
      const shd = argU16(s);
      const pattern = shd >> 10;
      props.shading = pattern === 1 ? ico(shd & 0x1f) : pattern === 0 ? ico((shd >> 5) & 0x1f) : props.shading;
      break;
    }
    case 0xc64d:
      // SHDOperand: cvFore (4), cvBack (4), ipat (2).
      if (s.arg.length >= 10) props.shading = colorRef(s, 4);
      break;
    case 0xd608:
      props.columns = tableColumns(s);
      props.borders = props.borders === true || (cellBorders(s) ?? props.borders);
      break;
    case 0xd605:
      props.borders = props.borders === true || anyBorder(s, 4, 6);
      break;
    case 0xd613:
      props.borders = props.borders === true || anyBorder(s, 8, 6);
      break;
  }
}

/** TDefTableOperand: itcMac, then itcMac + 1 column edges (i16), then TC80 cells. */
function tableColumns(s: Sprm): number[] | null {
  const cells = argU8(s);
  if (cells === 0 || s.arg.length < 1 + (cells + 1) * 2) return null;
  const edges: number[] = [];
  for (let i = 0; i <= cells; i++) edges.push(argI16(s, 1 + i * 2));
  return edges;
}

/** Border presence from the TC80 array that follows the column edges (each TC80 holds four Brc80). */
function cellBorders(s: Sprm): boolean | null {
  const cells = argU8(s);
  const start = 1 + (cells + 1) * 2;
  const count = Math.floor((s.arg.length - start) / 20);
  if (count <= 0) return null;
  for (let i = 0; i < count; i++) {
    for (let side = 0; side < 4; side++) {
      const type = argU8(s, start + i * 20 + 4 + side * 4 + 1);
      if (type !== 0 && type !== 0xff) return true;
    }
  }
  return false;
}

/** True when any of `count` borders of `size` bytes has a line type (second byte of Brc80, fifth of Brc). */
function anyBorder(s: Sprm, size: number, count: number): boolean {
  const typeOffset = size === 4 ? 1 : 5;
  for (let i = 0; i < count; i++) {
    const type = argU8(s, i * size + typeOffset);
    if (type !== 0 && type !== 0xff) return true;
  }
  return false;
}
