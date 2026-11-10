/**
 * DrawingML tables (`a:tbl`): grid, merged cells, cell fills/borders and table styles.
 */

import { type Rgba, tint } from "../shared/color";
import { attr, boolAttr, intAttr, kid, kids } from "../shared/xml";
import {
  colorIn,
  type DrawContext,
  fillElement,
  fillFromRef,
  resolveFill,
  resolveStroke,
  schemeColor,
} from "./drawing";
import type { Fill, Stroke, TableCell, TableModel } from "./model";
import type { PptxPackage } from "./package";
import { buildTextBody, type TextChain } from "./text";

type Edge = "left" | "right" | "top" | "bottom" | "insideH" | "insideV";

interface StylePart {
  fill?: Fill;
  color?: Rgba;
  bold?: boolean;
  borders: Partial<Record<Edge, Stroke | null>>;
}

type TableStyle = Partial<Record<string, StylePart>>;

const PARTS = ["wholeTbl", "band1H", "band2H", "band1V", "band2V", "firstCol", "lastCol", "firstRow", "lastRow"];
const EDGES: readonly Edge[] = ["left", "right", "top", "bottom", "insideH", "insideV"];

/** Well-known built-in style ids that files reference without defining them. */
const NO_STYLE_NO_GRID = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}";
const NO_STYLE_TABLE_GRID = "{5940675A-B579-460E-94D1-54222C63F5DA}";

function parseStylePart(el: Element | undefined, ctx: DrawContext): StylePart | undefined {
  if (!el) return undefined;
  const txStyle = kid(el, "tcTxStyle");
  const tcStyle = kid(el, "tcStyle");
  const fillHolder = kid(tcStyle, "fill");
  const fill = resolveFill(fillElement(fillHolder), ctx) ?? fillFromRef(kid(tcStyle, "fillRef"), ctx);
  const borders: StylePart["borders"] = {};
  const bdr = kid(tcStyle, "tcBdr");
  for (const edge of EDGES) {
    const side = kid(bdr, edge);
    if (!side) continue;
    const ln = kid(side, "ln");
    borders[edge] = resolveStroke(ln, ln ? undefined : kid(side, "lnRef"), ctx) ?? null;
  }
  const b = attr(txStyle, "b");
  return {
    fill,
    color: colorIn(txStyle, ctx) ?? colorIn(kid(txStyle, "fontRef"), ctx),
    bold: b === undefined ? undefined : b === "on",
    borders,
  };
}

function line(color: Rgba, width: number): Stroke {
  return { color, width };
}

/** Approximation of PowerPoint's default "Medium Style 2 - Accent 1" for undefined built-in ids. */
function builtinStyle(styleId: string | undefined, ctx: DrawContext): TableStyle {
  const dark = schemeColor("tx1", ctx) ?? { r: 0, g: 0, b: 0, a: 1 };
  const light = schemeColor("bg1", ctx) ?? { r: 255, g: 255, b: 255, a: 1 };
  if (styleId === NO_STYLE_NO_GRID) return { wholeTbl: { color: dark, borders: {} } };
  if (styleId === NO_STYLE_TABLE_GRID) {
    const grid = line(dark, 12700);
    return {
      wholeTbl: {
        color: dark,
        borders: { left: grid, right: grid, top: grid, bottom: grid, insideH: grid, insideV: grid },
      },
    };
  }
  const accent = schemeColor("accent1", ctx) ?? { r: 91, g: 91, b: 247, a: 1 };
  const white = line(light, 12700);
  const strong = { fill: { kind: "solid", color: accent } as Fill, color: light, bold: true };
  return {
    wholeTbl: {
      fill: { kind: "solid", color: tint(accent, 0.2) },
      color: dark,
      borders: { left: white, right: white, top: white, bottom: white, insideH: white, insideV: white },
    },
    band1H: { fill: { kind: "solid", color: tint(accent, 0.4) }, borders: {} },
    band1V: { fill: { kind: "solid", color: tint(accent, 0.4) }, borders: {} },
    firstRow: { ...strong, borders: { bottom: line(light, 38100) } },
    lastRow: { ...strong, borders: { top: line(light, 38100) } },
    firstCol: { ...strong, borders: {} },
    lastCol: { ...strong, borders: {} },
  };
}

function tableStyle(pkg: PptxPackage, styleId: string | undefined, ctx: DrawContext): TableStyle {
  const el = pkg.tableStyle(styleId);
  if (!el) return builtinStyle(styleId, ctx);
  const style: TableStyle = {};
  for (const name of PARTS) style[name] = parseStylePart(kid(el, name), ctx);
  return style;
}

interface Flags {
  firstRow: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  bandRow: boolean;
  bandCol: boolean;
}

/** Style parts for a cell, lowest priority first. */
function partsFor(style: TableStyle, flags: Flags, row: number, col: number, rows: number, cols: number): StylePart[] {
  const out: (StylePart | undefined)[] = [style.wholeTbl];
  const dataRow = row - (flags.firstRow ? 1 : 0);
  const dataCol = col - (flags.firstCol ? 1 : 0);
  if (flags.bandCol && dataCol >= 0) out.push(dataCol % 2 === 0 ? style.band1V : style.band2V);
  if (flags.bandRow && dataRow >= 0) out.push(dataRow % 2 === 0 ? style.band1H : style.band2H);
  if (flags.firstCol && col === 0) out.push(style.firstCol);
  if (flags.lastCol && col === cols - 1) out.push(style.lastCol);
  if (flags.firstRow && row === 0) out.push(style.firstRow);
  if (flags.lastRow && row === rows - 1) out.push(style.lastRow);
  return out.filter((p): p is StylePart => p !== undefined);
}

function styleBorder(
  parts: StylePart[],
  edge: "left" | "right" | "top" | "bottom",
  outer: boolean,
): Stroke | undefined {
  const inner: Edge = edge === "left" || edge === "right" ? "insideV" : "insideH";
  let result: Stroke | null | undefined;
  for (const part of parts) {
    const own = part.borders[edge];
    const candidate = own !== undefined ? own : outer ? undefined : part.borders[inner];
    if (candidate !== undefined) result = candidate;
  }
  return result ?? undefined;
}

/** Inputs shared by every cell's text. */
export interface TableTextContext {
  lists: (Element | undefined)[];
  slideNumber: number;
}

/** Parses `a:tbl` into a grid model. Covered cells (`hMerge`/`vMerge`) are omitted. */
export function parseTable(tbl: Element, pkg: PptxPackage, ctx: DrawContext, text: TableTextContext): TableModel {
  const tblPr = kid(tbl, "tblPr");
  const flags: Flags = {
    firstRow: boolAttr(tblPr, "firstRow", false),
    lastRow: boolAttr(tblPr, "lastRow", false),
    firstCol: boolAttr(tblPr, "firstCol", false),
    lastCol: boolAttr(tblPr, "lastCol", false),
    bandRow: boolAttr(tblPr, "bandRow", false),
    bandCol: boolAttr(tblPr, "bandCol", false),
  };
  const style = tableStyle(pkg, kid(tblPr, "tableStyleId")?.textContent?.trim(), ctx);
  const cols = kids(kid(tbl, "tblGrid"), "gridCol").map((c) => Math.max(0, intAttr(c, "w", 0)));
  const rowEls = kids(tbl, "tr");
  const rows = rowEls.map((r) => Math.max(0, intAttr(r, "h", 0)));
  const cells: TableCell[] = [];

  rowEls.forEach((tr, row) => {
    let col = 0;
    for (const tc of kids(tr, "tc")) {
      const here = col;
      col++;
      if (here >= cols.length) break;
      if (boolAttr(tc, "hMerge", false) || boolAttr(tc, "vMerge", false)) continue;
      const colSpan = Math.max(1, Math.min(intAttr(tc, "gridSpan", 1), cols.length - here));
      const rowSpan = Math.max(1, Math.min(intAttr(tc, "rowSpan", 1), rows.length - row));
      const tcPr = kid(tc, "tcPr");
      const parts = partsFor(style, flags, row, here, rows.length, cols.length);
      const own = resolveFill(fillElement(tcPr), ctx);
      const styled = parts.reduce<Fill | undefined>((acc, p) => p.fill ?? acc, undefined);
      const color = parts.reduce<Rgba | undefined>((acc, p) => p.color ?? acc, undefined);
      const bold = parts.reduce<boolean | undefined>((acc, p) => p.bold ?? acc, undefined);
      const side = (local: string, edge: "left" | "right" | "top" | "bottom", outer: boolean) => {
        const ln = kid(tcPr, local);
        if (ln) return resolveStroke(ln, undefined, ctx);
        return styleBorder(parts, edge, outer);
      };
      const chain: TextChain = {
        lists: text.lists,
        bodyPrs: [tcPr],
        override: { color, bold },
        slideNumber: text.slideNumber,
        insets: {
          l: intAttr(tcPr, "marL", 91440),
          r: intAttr(tcPr, "marR", 91440),
          t: intAttr(tcPr, "marT", 45720),
          b: intAttr(tcPr, "marB", 45720),
        },
      };
      cells.push({
        row,
        col: here,
        rowSpan,
        colSpan,
        fill: own ?? styled,
        borders: {
          l: side("lnL", "left", here === 0),
          r: side("lnR", "right", here + colSpan === cols.length),
          t: side("lnT", "top", row === 0),
          b: side("lnB", "bottom", row + rowSpan === rows.length),
        },
        text: buildTextBody(kid(tc, "txBody"), chain, ctx),
      });
    }
  });
  return { cols, rows, cells };
}
