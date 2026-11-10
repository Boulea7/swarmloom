import { type FlowContext, type FlowStats, inline, tableRows } from "./flow";
import type { ContentBudget } from "./kit/budget";
import { lengthPx, px, styleText } from "./kit/css";
import type { FontReport } from "./kit/fonts";
import { attrs, escapeHtml } from "./kit/html";
import { openSheet, type SheetRender, type SheetSpec } from "./kit/sheet";
import { a, children, isOdf, NS } from "./ns";
import { bodyOf, type OdfPackage } from "./package";
import { StyleClasses, textCss } from "./style-css";
import type { OdfStyles } from "./styles";

/** Result of rendering a spreadsheet. */
export interface SpreadsheetRender extends SheetRender {
  stats: FlowStats;
  /** Sheets (tables) rendered. */
  tables: number;
}

/** Grid limits: wider or longer sheets are cut and reported. */
export const MAX_COLUMNS = 40;
export const MAX_ROWS = 200;
const DEFAULT_COLUMN = 85;
const DEFAULT_ROW = 17;
const HEAD_W = 40;
const HEAD_H = 20;
const TITLE_H = 36;
const PAD = 16;

interface Cell {
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
  html: string;
  chars: number;
  klass: string;
  valueType: string;
  wrap: boolean;
  hAlign?: string;
  vAlign?: string;
  filled: boolean;
}

interface Grid {
  name: string;
  widths: number[];
  heights: number[];
  cells: Cell[];
  usedRows: number;
  usedCols: number;
  cut: boolean;
}

/** Spreadsheet column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columns(table: Element, fc: FlowContext): { widths: number[]; defaults: (string | null)[] } {
  const widths: number[] = [];
  const defaults: (string | null)[] = [];
  const stack = Array.from(table.children).reverse();
  while (stack.length > 0 && widths.length < MAX_COLUMNS) {
    const c = stack.pop() as Element;
    if (isOdf(c, "table", "table-column")) {
      const style = fc.styles.resolve("table-column", a(c, "table:style-name"));
      const width = lengthPx(style?.props["table-column"]?.get("style:column-width")) ?? DEFAULT_COLUMN;
      const repeat = Math.min(Number(a(c, "table:number-columns-repeated") ?? 1) || 1, MAX_COLUMNS - widths.length);
      for (let i = 0; i < repeat; i++) {
        widths.push(Math.max(8, Math.min(width, 800)));
        defaults.push(a(c, "table:default-cell-style-name"));
      }
    } else if (c.namespaceURI === NS.table && /^table-(?:header-columns|columns|column-group)$/.test(c.localName)) {
      stack.push(...Array.from(c.children).reverse());
    }
  }
  return { widths, defaults };
}

const NUMERIC = new Set(["float", "percentage", "currency", "date", "time"]);

function cellContent(cell: Element, fc: FlowContext): { html: string; chars: number } {
  const lines: string[] = [];
  let chars = 0;
  for (const p of Array.from(cell.children)) {
    if (!isOdf(p, "text", "p") && !isOdf(p, "text", "h")) continue;
    lines.push(inline(p, fc));
    chars += (p.textContent ?? "").length;
  }
  return { html: lines.join("<br>"), chars };
}

function readGrid(table: Element, fc: FlowContext): Grid {
  const { widths, defaults } = columns(table, fc);
  const heights: number[] = [];
  const cells: Cell[] = [];
  const covered = new Set<number>();
  let usedRows = 0;
  let usedCols = 0;
  let cut = false;
  let r = 0;
  for (const row of tableRows(table)) {
    const repeat = Math.max(1, Number(a(row, "table:number-rows-repeated") ?? 1) || 1);
    const rowStyle = fc.styles.resolve("table-row", a(row, "table:style-name"));
    const height = lengthPx(rowStyle?.props["table-row"]?.get("style:row-height")) ?? DEFAULT_ROW;
    const rowDefault = a(row, "table:default-cell-style-name");
    const rowCells: Cell[] = [];
    let c = 0;
    for (const el of Array.from(row.children)) {
      if (c >= MAX_COLUMNS) {
        if (el.textContent?.trim()) cut = true;
        break;
      }
      const span = Math.max(1, Number(a(el, "table:number-columns-repeated") ?? 1) || 1);
      if (isOdf(el, "table", "covered-table-cell")) {
        c += span;
        continue;
      }
      if (!isOdf(el, "table", "table-cell")) continue;
      const content = cellContent(el, fc);
      const styleName = a(el, "table:style-name") ?? rowDefault ?? defaults[c] ?? null;
      const style = fc.styles.resolve("table-cell", styleName);
      const cp = style?.props["table-cell"];
      const bg = cp?.get("fo:background-color");
      const filled = !!bg && bg !== "transparent";
      const colspan = Math.max(1, Math.min(Number(a(el, "table:number-columns-spanned") ?? 1) || 1, MAX_COLUMNS));
      const rowspan = Math.max(1, Math.min(Number(a(el, "table:number-rows-spanned") ?? 1) || 1, MAX_ROWS));
      const count = content.html || filled || colspan > 1 || rowspan > 1 ? Math.min(span, MAX_COLUMNS - c) : 0;
      for (let k = 0; k < count; k++) {
        const cell: Cell = {
          row: r,
          col: c + k,
          colspan,
          rowspan,
          html: content.html,
          chars: content.chars,
          klass: fc.classes.of("table-cell", styleName),
          valueType: a(el, "office:value-type") ?? "string",
          wrap: cp?.get("fo:wrap-option") === "wrap",
          filled,
        };
        const h = style?.props.paragraph?.get("fo:text-align");
        if (h) cell.hAlign = h;
        const v = cp?.get("style:vertical-align");
        if (v) cell.vAlign = v;
        rowCells.push(cell);
      }
      c += span;
    }
    if (rowCells.length > 0 && r >= MAX_ROWS) {
      // Content below the grid limit: stop reading (filler rows past it are skipped silently).
      if (rowCells.some((cell) => cell.html)) cut = true;
      break;
    }
    // Repeated rows with content are expanded up to the limit; empty filler rows only advance.
    const expand = rowCells.length > 0 ? Math.min(repeat, MAX_ROWS - r) : 0;
    for (let k = 0; k < Math.min(repeat, MAX_ROWS - r); k++) heights.push(Math.max(4, Math.min(height, 600)));
    for (let k = 0; k < expand; k++) {
      for (const cell of rowCells) {
        if (covered.has((r + k) * 4096 + cell.col)) continue;
        cells.push({ ...cell, row: r + k });
        // Only content and merges define the used range; fill alone (whole formatted rows) does not.
        if (cell.html || cell.colspan > 1 || cell.rowspan > 1) {
          usedRows = Math.max(usedRows, r + k + cell.rowspan);
          usedCols = Math.max(usedCols, cell.col + cell.colspan);
        }
        for (let dr = 0; dr < cell.rowspan; dr++) {
          for (let dc = 0; dc < cell.colspan; dc++) if (dr || dc) covered.add((r + k + dr) * 4096 + cell.col + dc);
        }
      }
    }
    r += repeat;
  }
  while (widths.length < usedCols) widths.push(DEFAULT_COLUMN);
  if (usedRows > MAX_ROWS || usedCols > MAX_COLUMNS) cut = true;
  const rowsInRange = Math.min(usedRows, MAX_ROWS);
  const colsInRange = Math.min(usedCols, MAX_COLUMNS);
  return {
    name: a(table, "table:name") ?? "Sheet",
    widths,
    heights,
    cells: cells.filter((c) => c.row < rowsInRange && c.col < colsInRange),
    usedRows: rowsInRange,
    usedCols: colsInRange,
    cut,
  };
}

function offsets(sizes: readonly number[], count: number): number[] {
  const out = [0];
  for (let i = 0; i < count; i++) out.push((out[i] as number) + (sizes[i] ?? DEFAULT_ROW));
  return out;
}

const H_ALIGN: Record<string, string> = {
  start: "flex-start",
  left: "flex-start",
  center: "center",
  end: "flex-end",
  right: "flex-end",
  justify: "flex-start",
};
const V_ALIGN: Record<string, string> = { top: "flex-start", middle: "center", bottom: "flex-end" };

/** Gridline segments of one axis, skipping the inside of merged cells. */
function gridPath(grid: Grid, xs: number[], ys: number[], rows: number, cols: number): string {
  const merged = grid.cells.filter((c) => c.colspan > 1 || c.rowspan > 1);
  const inside = (r: number, c: number, horizontal: boolean) =>
    merged.some((m) =>
      horizontal
        ? c >= m.col && c < m.col + m.colspan && r > m.row && r < m.row + m.rowspan
        : r >= m.row && r < m.row + m.rowspan && c > m.col && c < m.col + m.colspan,
    );
  let d = "";
  for (let r = 0; r <= rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const draw = c < cols && !inside(r, c, true);
      if (draw && start < 0) start = c;
      if (!draw && start >= 0) {
        d += `M${xs[start]} ${(ys[r] as number) + 0.5}H${xs[c]}`;
        start = -1;
      }
    }
  }
  for (let c = 0; c <= cols; c++) {
    let start = -1;
    for (let r = 0; r <= rows; r++) {
      const draw = r < rows && !inside(r, c, false);
      if (draw && start < 0) start = r;
      if (!draw && start >= 0) {
        d += `M${(xs[c] as number) + 0.5} ${ys[start]}V${ys[r]}`;
        start = -1;
      }
    }
  }
  return d;
}

function renderGrid(grid: Grid, budget: ContentBudget): { html: string; spec: SheetSpec; cut: boolean } {
  // Rows are kept while the budget lasts; a row is never split.
  let rows = 0;
  let cut = grid.cut;
  const contentByRow = new Map<number, Cell[]>();
  for (const c of grid.cells) {
    if (!c.html) continue;
    const list = contentByRow.get(c.row);
    if (list) list.push(c);
    else contentByRow.set(c.row, [c]);
  }
  for (; rows < grid.usedRows; rows++) {
    const content = contentByRow.get(rows) ?? [];
    if (budget.exhausted && content.length > 0) {
      cut = true;
      budget.skip(grid.cells.filter((c) => c.row >= rows && c.html).length);
      break;
    }
    for (const c of content) budget.take(c.chars);
  }
  rows = Math.max(rows, 1);
  const cols = Math.max(grid.usedCols, 1);
  const xs = offsets(grid.widths, cols);
  const ys = offsets(grid.heights, rows);
  const gridW = xs[cols] as number;
  const gridH = ys[rows] as number;
  const occupied = new Set(grid.cells.filter((c) => c.row < rows && c.html).map((c) => c.row * 4096 + c.col));
  const rowsHtml: string[] = [];
  for (const c of grid.cells) {
    if (c.row >= rows || c.col >= cols) continue;
    const endCol = Math.min(c.col + c.colspan, cols);
    const endRow = Math.min(c.row + c.rowspan, rows);
    const numeric = NUMERIC.has(c.valueType);
    const h = c.hAlign ?? (numeric ? "end" : c.valueType === "boolean" ? "center" : "start");
    let right = endCol;
    // Unwrapped left-aligned text spills into empty neighbours, as in spreadsheet applications.
    if (c.html && !c.wrap && !c.filled && c.colspan === 1 && (h === "start" || h === "left")) {
      while (right < cols && !occupied.has(c.row * 4096 + right) && right - c.col < 8) right++;
    }
    const css = styleText({
      left: px(xs[c.col] as number),
      top: px(ys[c.row] as number),
      width: px((xs[right] as number) - (xs[c.col] as number)),
      height: px((ys[endRow] as number) - (ys[c.row] as number)),
      "justify-content": H_ALIGN[h] ?? "flex-start",
      "align-items": V_ALIGN[c.vAlign ?? "bottom"] ?? "flex-end",
      "white-space": c.wrap ? "normal" : "nowrap",
      ...(c.wrap ? { "text-align": h === "end" || h === "right" ? "right" : h === "center" ? "center" : "left" } : {}),
    });
    rowsHtml[c.row] =
      (rowsHtml[c.row] ?? "") +
      `<div${attrs({ class: `ods-cell${c.klass ? ` ${c.klass}` : ""}`, style: css, role: "cell" })}>${c.html ? `<span>${c.html}</span>` : ""}</div>`;
  }
  // Rows group their cells for assistive semantics without adding boxes (display: contents).
  const cellsHtml = rowsHtml.map((row) => (row ? `<div role="row" class="ods-row">${row}</div>` : "")).join("");
  let heads = "";
  for (let c = 0; c < cols; c++) {
    const css = styleText({
      left: px(HEAD_W + (xs[c] as number)),
      top: "0px",
      width: px(grid.widths[c] ?? DEFAULT_COLUMN),
      height: px(HEAD_H),
    });
    heads += `<div class="ods-head" style="${css}">${columnName(c)}</div>`;
  }
  for (let r = 0; r < rows; r++) {
    const css = styleText({
      left: "0px",
      top: px(HEAD_H + (ys[r] as number)),
      width: px(HEAD_W),
      height: px(grid.heights[r] ?? DEFAULT_ROW),
    });
    heads += `<div class="ods-head" style="${css}">${r + 1}</div>`;
  }
  const path = gridPath(grid, xs, ys, rows, cols);
  const w = HEAD_W + gridW;
  const h = HEAD_H + gridH;
  const svg = `<svg class="ods-lines" width="${Math.ceil(gridW + 1)}" height="${Math.ceil(gridH + 1)}" viewBox="0 0 ${Math.ceil(gridW + 1)} ${Math.ceil(gridH + 1)}" aria-hidden="true"><path d="${path}" fill="none" stroke="#D5D5DE" stroke-width="1"/></svg>`;
  const body = `<div class="ods-grid" style="width:${px(w)};height:${px(h)}">${heads}<div class="ods-cells" role="table" style="left:${px(HEAD_W)};top:${px(HEAD_H)};width:${px(gridW)};height:${px(gridH)}">${svg}${cellsHtml}</div></div>`;
  const spec: SheetSpec = { w: Math.ceil(w + 2 * PAD), h: Math.ceil(h + TITLE_H + 2 * PAD), fixed: true };
  const title = `<div class="ods-title">${escapeHtml(grid.name)}</div>`;
  return { html: `${openSheet(spec, { className: "odf ods", label: grid.name })}${title}${body}</section>`, spec, cut };
}

function baseCss(defaultText: string): string {
  return [
    `.ods{${defaultText}padding:${PAD}px;font-size:10pt;}`,
    `.ods .ods-title{height:${TITLE_H - 8}px;margin-bottom:8px;display:flex;align-items:center;font:600 13px/1 sans-serif;color:#3B3B4F;}`,
    ".ods .ods-grid{position:relative;}",
    ".ods .ods-cells{position:absolute;}",
    ".ods .ods-lines{position:absolute;left:0;top:0;}",
    ".ods .ods-head{position:absolute;display:flex;align-items:center;justify-content:center;background:#F3F3F7;color:#6B6B7B;font:11px/1 sans-serif;box-shadow:inset -1px -1px 0 #D5D5DE;}",
    ".ods .ods-cell{position:absolute;display:flex;overflow:hidden;padding:0 3px;line-height:1.15;}",
    ".ods .ods-cell>span{min-width:0;}",
    ".ods .ods-row{display:contents;}",
    ".ods .odf-tab{white-space:pre;}",
    ".ods .odf-link{color:#1B4FD8;text-decoration:underline;}",
  ].join("");
}

/** Renders the sheets of an ODS body as grids (cached values only; formulas are never evaluated). */
export function renderSpreadsheet(
  pkg: OdfPackage,
  styles: OdfStyles,
  fonts: FontReport,
  budget: ContentBudget,
): SpreadsheetRender {
  const classes = new StyleClasses(styles, fonts, "ods");
  const stats: FlowStats = { objects: 0, tableCuts: 0 };
  const fc: FlowContext = { pkg, styles, classes, budget, stats, scope: "content", notes: [], hoisted: [], page: 1 };
  const tables = children(bodyOf(pkg), "table", "table");
  const sheets: SheetSpec[] = [];
  let html = "";
  let index = 0;
  for (; index < tables.length && !budget.exhausted; index++) {
    const grid = readGrid(tables[index] as Element, fc);
    if (grid.cells.length === 0 && tables.length > 1) continue;
    const out = renderGrid(grid, budget);
    if (out.cut) stats.tableCuts++;
    html += out.html;
    sheets.push(out.spec);
  }
  budget.skip(tables.length - index);
  const defaultText = styleText(textCss(styles.defaultProps("table-cell").text, styles, fonts));
  return { html, css: baseCss(defaultText) + classes.css(), sheets, role: "page", stats, tables: sheets.length };
}
