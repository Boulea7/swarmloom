import { OfficeFormatError, throwIfAborted } from "../shared/errors";
import { kid, kids, nsAttr, readXml } from "../shared/xml";
import type { ZipArchive } from "../shared/zip";
import {
  type Cell,
  type CellKind,
  type CellStyle,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  detectHeaderRow,
  type Merge,
  type SheetLimits,
  type SheetModel,
  type WorkbookModel,
} from "./model";

/** Largest repeat count honoured for a non-empty row or cell (guards against bogus files). */
const MAX_REPEAT = 1000;

/** ODF length ("2.258cm", "0.1665in", "12pt", "64px") -> CSS px. */
function lengthPx(value: string | undefined): number | undefined {
  const m = /^([\d.]+)(cm|mm|in|pt|pc|px)$/.exec(value?.trim() ?? "");
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  const per: Record<string, number> = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 };
  const px = n * (per[m[2] ?? "px"] ?? 1);
  return Number.isFinite(px) ? Math.round(px) : undefined;
}

interface OdsStyles {
  cells: Map<string, CellStyle>;
  columns: Map<string, number>;
  rows: Map<string, number>;
}

const TEXT_ALIGN: Readonly<Record<string, CellStyle["hAlign"]>> = {
  start: "left",
  left: "left",
  center: "center",
  end: "right",
  right: "right",
  justify: "justify",
};

function readStyles(roots: (Element | undefined)[]): OdsStyles {
  const out: OdsStyles = { cells: new Map(), columns: new Map(), rows: new Map() };
  for (const root of roots) {
    for (const container of [kid(root, "automatic-styles"), kid(root, "styles")]) {
      for (const style of kids(container, "style")) {
        const name = nsAttr(style, "name");
        if (!name) continue;
        const family = nsAttr(style, "family");
        if (family === "table-column") {
          const w = lengthPx(nsAttr(kid(style, "table-column-properties"), "column-width"));
          if (w !== undefined) out.columns.set(name, w);
        } else if (family === "table-row") {
          const h = lengthPx(nsAttr(kid(style, "table-row-properties"), "row-height"));
          if (h !== undefined) out.rows.set(name, h);
        } else if (family === "table-cell") {
          out.cells.set(name, cellStyle(style));
        }
      }
    }
  }
  return out;
}

function cellStyle(style: Element): CellStyle {
  const out: CellStyle = {};
  const cell = kid(style, "table-cell-properties");
  const text = kid(style, "text-properties");
  const para = kid(style, "paragraph-properties");
  const bg = nsAttr(cell, "background-color");
  if (bg && bg !== "transparent" && /^#[0-9a-f]{6}$/i.test(bg)) out.fill = bg;
  if (nsAttr(cell, "wrap-option") === "wrap") out.wrap = true;
  const v = nsAttr(cell, "vertical-align");
  if (v === "top" || v === "bottom") out.vAlign = v;
  else if (v === "middle") out.vAlign = "middle";
  const weight = nsAttr(text, "font-weight");
  if (weight === "bold" || Number(weight) >= 600) out.bold = true;
  if (nsAttr(text, "font-style") === "italic") out.italic = true;
  const underline = nsAttr(text, "text-underline-style");
  if (underline && underline !== "none") out.underline = true;
  const color = nsAttr(text, "color");
  if (color && /^#[0-9a-f]{6}$/i.test(color)) out.color = color;
  const size = /^([\d.]+)pt$/.exec(nsAttr(text, "font-size") ?? "");
  if (size?.[1]) out.fontSize = Number(size[1]);
  const font = nsAttr(text, "font-name");
  if (font) out.font = font;
  const align = TEXT_ALIGN[nsAttr(para, "text-align") ?? ""];
  if (align) out.hAlign = align;
  return out;
}

/** Text of a cell: `text:p` paragraphs joined by newlines, honouring `text:s`, tabs and line breaks. */
function cellText(cell: Element): string {
  const paragraphs: string[] = [];
  for (const p of kids(cell)) {
    if (p.localName !== "p" && p.localName !== "h") continue;
    paragraphs.push(inlineText(p));
  }
  return paragraphs.join("\n");
}

function inlineText(node: Node): string {
  let out = "";
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? "";
    } else if (n.nodeType === 1) {
      const el = n as Element;
      if (el.localName === "s") out += " ".repeat(Math.min(1000, Number(nsAttr(el, "c") ?? "1") || 1));
      else if (el.localName === "tab") out += "\t";
      else if (el.localName === "line-break") out += "\n";
      else if (el.localName !== "annotation") out += inlineText(el);
    }
  }
  return out;
}

const KINDS: Readonly<Record<string, CellKind>> = {
  float: "number",
  percentage: "number",
  currency: "number",
  date: "number",
  time: "number",
  boolean: "boolean",
  string: "string",
};

/** Rows of a table, flattening header-rows/row-groups wrappers. */
function tableRows(table: Element): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    for (const child of kids(el)) {
      if (child.localName === "table-row") out.push(child);
      else if (/^table-(header-)?rows$|^table-row-group$/.test(child.localName)) visit(child);
    }
  };
  visit(table);
  return out;
}

function tableColumns(table: Element): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    for (const child of kids(el)) {
      if (child.localName === "table-column") out.push(child);
      else if (/^table-(header-)?columns$|^table-column-group$/.test(child.localName)) visit(child);
    }
  };
  visit(table);
  return out;
}

function repeatOf(el: Element, name: string): number {
  const n = Number(nsAttr(el, name) ?? "1");
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function readTable(table: Element, styles: OdsStyles, limits: SheetLimits, index: number): SheetModel {
  const cells: Cell[] = [];
  const merges: Merge[] = [];
  const rowHeights: number[] = [];
  let droppedCells = 0;
  let lastRow = -1;
  let lastCol = -1;
  let usedRows = 0;
  let usedCols = 0;
  let r = 0;
  for (const row of tableRows(table)) {
    const rowRepeat = repeatOf(row, "number-rows-repeated");
    const height = styles.rows.get(nsAttr(row, "style-name") ?? "");
    const hidden = nsAttr(row, "visibility") === "collapse";
    const rowCells: { col: number; text: string; kind: CellKind; style?: CellStyle; span?: [number, number] }[] = [];
    let c = 0;
    for (const cell of kids(row)) {
      if (cell.localName !== "table-cell" && cell.localName !== "covered-table-cell") continue;
      const colRepeat = repeatOf(cell, "number-columns-repeated");
      const text = cell.localName === "table-cell" ? cellText(cell) : "";
      const style = styles.cells.get(nsAttr(cell, "style-name") ?? "");
      const paints = text !== "" || style?.fill !== undefined;
      if (paints) {
        const kind = KINDS[nsAttr(cell, "value-type") ?? "string"] ?? "string";
        const spanC = repeatOf(cell, "number-columns-spanned");
        const spanR = repeatOf(cell, "number-rows-spanned");
        for (let k = 0; k < Math.min(colRepeat, MAX_REPEAT); k++) {
          rowCells.push({
            col: c + k,
            text,
            kind,
            style,
            span: spanC > 1 || spanR > 1 ? [spanR, spanC] : undefined,
          });
        }
      }
      c += colRepeat;
    }
    // Trailing filler rows ("repeat 1048000 empty rows") are common: only real rows count.
    const repeat = rowCells.length > 0 ? Math.min(rowRepeat, MAX_REPEAT) : rowRepeat;
    for (let k = 0; k < repeat && rowCells.length > 0; k++) {
      const rowIndex = r + k;
      for (const rc of rowCells) {
        if (rc.text !== "") {
          usedRows = Math.max(usedRows, rowIndex + 1);
          usedCols = Math.max(usedCols, rc.col + 1);
        }
        if (rowIndex >= limits.maxRows || rc.col >= limits.maxCols) {
          if (rc.text !== "") droppedCells++;
          continue;
        }
        cells.push({ row: rowIndex, col: rc.col, text: rc.text, kind: rc.kind, style: rc.style });
        lastRow = Math.max(lastRow, rowIndex);
        lastCol = Math.max(lastCol, rc.col);
        if (rc.span) {
          const merge = {
            r0: rowIndex,
            c0: rc.col,
            r1: Math.min(rowIndex + rc.span[0] - 1, limits.maxRows - 1),
            c1: Math.min(rc.col + rc.span[1] - 1, limits.maxCols - 1),
          };
          merges.push(merge);
          lastRow = Math.max(lastRow, merge.r1);
          lastCol = Math.max(lastCol, merge.c1);
        }
      }
    }
    for (let k = 0; k < Math.min(rowRepeat, limits.maxRows) && r + k < limits.maxRows; k++) {
      rowHeights[r + k] = hidden ? 0 : (height ?? DEFAULT_ROW_HEIGHT);
    }
    r += rowRepeat;
  }
  const rows = Math.min(limits.maxRows, lastRow + 1);
  const cols = Math.min(limits.maxCols, lastCol + 1);
  const colWidths: number[] = [];
  let ci = 0;
  for (const col of tableColumns(table)) {
    const repeat = repeatOf(col, "number-columns-repeated");
    const width = nsAttr(col, "visibility") === "collapse" ? 0 : styles.columns.get(nsAttr(col, "style-name") ?? "");
    for (let k = 0; k < repeat && ci < cols; k++) colWidths[ci++] = width ?? DEFAULT_COL_WIDTH;
    if (ci >= cols) break;
  }
  while (colWidths.length < cols) colWidths.push(DEFAULT_COL_WIDTH);
  return {
    name: nsAttr(table, "name") ?? `Sheet${index + 1}`,
    cells,
    rows,
    cols,
    colWidths,
    rowHeights: Array.from({ length: Math.max(0, rows) }, (_, i) => rowHeights[i] ?? DEFAULT_ROW_HEIGHT),
    merges,
    showGrid: true,
    fontSize: 10,
    font: "Liberation Sans",
    droppedCells,
    usedRows,
    usedCols,
    headerRow: detectHeaderRow(cells),
  };
}

/**
 * Reads an OpenDocument spreadsheet: cell display text (ODF stores the formatted value),
 * spans, column widths, row heights and basic cell styles. Formulas are not evaluated.
 */
export function readOds(zip: ZipArchive, limits: SheetLimits, signal?: AbortSignal): WorkbookModel {
  const content = readXml(zip, "content.xml");
  if (!content) throw new OfficeFormatError("The OpenDocument spreadsheet has no content.xml");
  const styles = readStyles([readXml(zip, "styles.xml"), content]);
  const spreadsheet = kid(kid(content, "body"), "spreadsheet");
  const tables = kids(spreadsheet, "table");
  if (tables.length === 0) throw new OfficeFormatError("The spreadsheet has no sheets");
  const sheets: SheetModel[] = [];
  for (const [i, table] of tables.slice(0, limits.maxSheets).entries()) {
    throwIfAborted(signal);
    sheets.push(readTable(table, styles, limits, i));
  }
  return { sheets, droppedSheets: Math.max(0, tables.length - limits.maxSheets) };
}
