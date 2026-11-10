import { cssColor, parseHex, sheetTint } from "../shared/color";
import { attr, boolAttr, intAttr, kid, kids, numAttr } from "../shared/xml";
import type { BorderSide, CellStyle } from "./model";
import { BUILTIN_FORMATS, isDateFormat } from "./numfmt";

/** The legacy 64-colour palette addressed by `indexed` colours (ECMA-376 Part 1, 18.8.27). */
const INDEXED: readonly string[] = [
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "800000",
  "008000",
  "000080",
  "808000",
  "800080",
  "008080",
  "C0C0C0",
  "808080",
  "9999FF",
  "993366",
  "FFFFCC",
  "CCFFFF",
  "660066",
  "FF8080",
  "0066CC",
  "CCCCFF",
  "000080",
  "FF00FF",
  "FFFF00",
  "00FFFF",
  "800080",
  "800000",
  "008080",
  "0000FF",
  "00CCFF",
  "CCFFFF",
  "CCFFCC",
  "FFFF99",
  "99CCFF",
  "FF99CC",
  "CC99FF",
  "FFCC99",
  "3366FF",
  "33CCCC",
  "99CC00",
  "FFCC00",
  "FF9900",
  "FF6600",
  "666699",
  "969696",
  "003366",
  "339966",
  "003300",
  "333300",
  "993300",
  "993366",
  "333399",
  "333333",
];

/** SpreadsheetML theme colour indices (0 lt1, 1 dk1, 2 lt2, 3 dk2, 4-9 accents, 10-11 links). */
const THEME_ORDER = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];

/** Office 2013+ default theme, used when the workbook has no theme part. */
const DEFAULT_THEME: Readonly<Record<string, string>> = {
  lt1: "FFFFFF",
  dk1: "000000",
  lt2: "E7E6E6",
  dk2: "44546A",
  accent1: "4472C4",
  accent2: "ED7D31",
  accent3: "A5A5A5",
  accent4: "FFC000",
  accent5: "5B9BD5",
  accent6: "70AD47",
  hlink: "0563C1",
  folHlink: "954F72",
};

/** Theme colours (hex by scheme name) from a DrawingML theme part. */
export function themePalette(theme: Element | undefined): Record<string, string> {
  const palette: Record<string, string> = { ...DEFAULT_THEME };
  const scheme = kid(kid(theme, "themeElements"), "clrScheme");
  for (const entry of kids(scheme)) {
    const color = entry.firstElementChild ?? undefined;
    const hex = color?.localName === "srgbClr" ? attr(color, "val") : attr(color, "lastClr");
    if (hex && parseHex(hex)) palette[entry.localName] = hex;
  }
  return palette;
}

/** Resolves a CT_Color element (`rgb`, `theme` + `tint`, `indexed`, `auto`) to CSS, or undefined. */
export function sheetColor(
  el: Element | undefined,
  palette: Record<string, string>,
  auto?: string,
): string | undefined {
  if (!el) return undefined;
  if (boolAttr(el, "auto", false)) return auto;
  let hex: string | undefined = attr(el, "rgb");
  const theme = intAttr(el, "theme");
  const indexed = intAttr(el, "indexed");
  if (!hex && theme !== undefined) hex = palette[THEME_ORDER[theme] ?? ""];
  if (!hex && indexed !== undefined) {
    // 64 and 65 are the system foreground and background.
    hex = indexed === 64 ? "000000" : indexed === 65 ? "FFFFFF" : INDEXED[indexed];
  }
  const rgba = parseHex(hex);
  if (!rgba) return undefined;
  // ARGB with a zero alpha byte is common in files that never meant transparency.
  const opaque = hex && hex.length === 8 && rgba.a === 0 ? { ...rgba, a: 1 } : rgba;
  return cssColor(sheetTint(opaque, numAttr(el, "tint", 0)));
}

interface FontStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  name?: string;
}

interface Xf {
  numFmtId: number;
  font?: FontStyle;
  fill?: string;
  borders?: CellStyle["borders"];
  hAlign?: CellStyle["hAlign"];
  vAlign?: CellStyle["vAlign"];
  wrap?: boolean;
  indent?: number;
}

const BORDER_STYLES: Readonly<Record<string, Omit<BorderSide, "color">>> = {
  thin: { width: 1, style: "solid" },
  hair: { width: 1, style: "dotted" },
  dotted: { width: 1, style: "dotted" },
  dashed: { width: 1, style: "dashed" },
  dashDot: { width: 1, style: "dashed" },
  dashDotDot: { width: 1, style: "dashed" },
  medium: { width: 2, style: "solid" },
  mediumDashed: { width: 2, style: "dashed" },
  mediumDashDot: { width: 2, style: "dashed" },
  mediumDashDotDot: { width: 2, style: "dashed" },
  slantDashDot: { width: 2, style: "dashed" },
  thick: { width: 3, style: "solid" },
  double: { width: 3, style: "double" },
};

const H_ALIGN: Readonly<Record<string, CellStyle["hAlign"]>> = {
  left: "left",
  center: "center",
  centerContinuous: "center",
  right: "right",
  justify: "justify",
  distributed: "justify",
  fill: "left",
};

const V_ALIGN: Readonly<Record<string, CellStyle["vAlign"]>> = {
  top: "top",
  center: "middle",
  bottom: "bottom",
  justify: "middle",
  distributed: "middle",
};

/** Parsed `xl/styles.xml`: number formats and cell formats addressed by a cell's `s`. */
export class Stylesheet {
  /** Default font of the workbook (font 0). */
  readonly fontSize: number;
  readonly fontName: string;
  private readonly xfs: Xf[];
  private readonly formats = new Map<number, string>();
  private readonly cache = new Map<number, CellStyle | undefined>();

  constructor(root: Element | undefined, palette: Record<string, string>) {
    for (const nf of kids(kid(root, "numFmts"), "numFmt")) {
      const id = intAttr(nf, "numFmtId");
      const code = attr(nf, "formatCode");
      if (id !== undefined && code !== undefined) this.formats.set(id, code);
    }
    const fonts = kids(kid(root, "fonts"), "font").map((f) => readFont(f, palette));
    const fills = kids(kid(root, "fills"), "fill").map((f) => readFill(f, palette));
    const borders = kids(kid(root, "borders"), "border").map((b) => readBorder(b, palette));
    const base = fonts[0];
    this.fontSize = base?.size ?? 11;
    this.fontName = base?.name ?? "Calibri";
    this.xfs = kids(kid(root, "cellXfs"), "xf").map((xf) => {
      const alignment = kid(xf, "alignment");
      const font = fonts[intAttr(xf, "fontId", 0)];
      const out: Xf = {
        numFmtId: intAttr(xf, "numFmtId", 0),
        font: font ? diffFont(font, base) : undefined,
        fill: fills[intAttr(xf, "fillId", 0)],
        borders: borders[intAttr(xf, "borderId", 0)],
      };
      if (alignment) {
        out.hAlign = H_ALIGN[attr(alignment, "horizontal") ?? ""];
        out.vAlign = V_ALIGN[attr(alignment, "vertical") ?? ""];
        out.wrap = boolAttr(alignment, "wrapText");
        out.indent = intAttr(alignment, "indent");
      }
      return out;
    });
  }

  /** Format code of cell format `s` ("General" when unknown). */
  formatCode(s: number): string {
    const id = this.xfs[s]?.numFmtId ?? 0;
    return this.formats.get(id) ?? BUILTIN_FORMATS[id] ?? "General";
  }

  /** True when cell format `s` displays numbers as dates or times. */
  isDate(s: number): boolean {
    const id = this.xfs[s]?.numFmtId ?? 0;
    // Built-in ids 14-22 and 45-47 are dates/times; 27-36 and 50-58 are East Asian dates.
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) {
      return !this.formats.has(id) || isDateFormat(this.formats.get(id));
    }
    return isDateFormat(this.formats.get(id));
  }

  /** Visual style of cell format `s`, or undefined when it is all defaults. */
  style(s: number): CellStyle | undefined {
    if (this.cache.has(s)) return this.cache.get(s);
    const xf = this.xfs[s];
    let style: CellStyle | undefined;
    if (xf) {
      const out: CellStyle = {};
      const f = xf.font;
      if (f?.bold) out.bold = true;
      if (f?.italic) out.italic = true;
      if (f?.underline) out.underline = true;
      if (f?.strike) out.strike = true;
      if (f?.color) out.color = f.color;
      if (f?.size) out.fontSize = f.size;
      if (f?.name) out.font = f.name;
      if (xf.fill) out.fill = xf.fill;
      if (xf.borders) out.borders = xf.borders;
      if (xf.hAlign) out.hAlign = xf.hAlign;
      if (xf.vAlign) out.vAlign = xf.vAlign;
      if (xf.wrap) out.wrap = true;
      if (xf.indent) out.indent = xf.indent;
      style = Object.keys(out).length > 0 ? out : undefined;
    }
    this.cache.set(s, style);
    return style;
  }
}

function readFont(font: Element, palette: Record<string, string>): FontStyle {
  const flag = (name: string) => {
    const el = kid(font, name);
    return el ? boolAttr(el, "val", true) : undefined;
  };
  const u = kid(font, "u");
  return {
    bold: flag("b"),
    italic: flag("i"),
    strike: flag("strike"),
    underline: u ? attr(u, "val") !== "none" : undefined,
    size: numAttr(kid(font, "sz"), "val"),
    name: attr(kid(font, "name"), "val"),
    color: sheetColor(kid(font, "color"), palette),
  };
}

/** Keeps only what differs from the workbook default font, so plain cells stay unstyled. */
function diffFont(font: FontStyle, base: FontStyle | undefined): FontStyle | undefined {
  const out: FontStyle = {};
  if (font.bold) out.bold = true;
  if (font.italic) out.italic = true;
  if (font.underline) out.underline = true;
  if (font.strike) out.strike = true;
  if (font.color && font.color !== base?.color) out.color = font.color;
  if (font.size && font.size !== base?.size) out.size = font.size;
  if (font.name && font.name !== base?.name) out.name = font.name;
  return Object.keys(out).length > 0 ? out : undefined;
}

function readFill(fill: Element, palette: Record<string, string>): string | undefined {
  const pattern = kid(fill, "patternFill");
  if (pattern) {
    const type = attr(pattern, "patternType") ?? (kid(pattern, "fgColor") ? "solid" : "none");
    if (type === "none") return undefined;
    // Hatched patterns are approximated by their foreground colour (background for gray125).
    const fg = sheetColor(kid(pattern, "fgColor"), palette);
    const bg = sheetColor(kid(pattern, "bgColor"), palette);
    if (type === "gray125" || type === "gray0625") return undefined;
    return fg ?? bg;
  }
  const gradient = kid(fill, "gradientFill");
  if (gradient) {
    const stops = kids(gradient, "stop")
      .map((stop) => sheetColor(kid(stop, "color"), palette))
      .filter((c): c is string => c !== undefined);
    if (stops.length >= 2) return `linear-gradient(${90 + numAttr(gradient, "degree", 0)}deg, ${stops.join(", ")})`;
    return stops[0];
  }
  return undefined;
}

function readBorder(border: Element, palette: Record<string, string>): CellStyle["borders"] {
  const side = (name: string): BorderSide | undefined => {
    const el = kid(border, name);
    const shape = BORDER_STYLES[attr(el, "style") ?? ""];
    if (!el || !shape) return undefined;
    return { ...shape, color: sheetColor(kid(el, "color"), palette, "#000000") ?? "#000000" };
  };
  const out = {
    l: side("left") ?? side("start"),
    r: side("right") ?? side("end"),
    t: side("top"),
    b: side("bottom"),
  };
  return out.l || out.r || out.t || out.b ? out : undefined;
}
