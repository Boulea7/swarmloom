import type { BoxLayer, CSSMap, GuideLayer, Layer, PathLayer, Rect, TextLayer } from "@swarmloom/core";
import { fontStack } from "../shared/fonts";
import { escapeHtml, px, round2 } from "../shared/html";
import { type BorderSide, type Cell, columnName, type Merge, type SheetModel } from "./model";

/** Natural (100% zoom) chrome sizes, px. */
const COL_HEADER_H = 22;
const TAB_H = 28;
const SHEET_GAP = 36;
const CELL_PAD_X = 4;
const INDENT_PX = 9;
const PT_TO_PX = 96 / 72;
/** Scale bounds: small sheets grow a little, wide sheets shrink until columns must be dropped. */
const MAX_SCALE = 1.25;
const MIN_SCALE = 0.6;

const PALETTE = {
  page: "#ffffff",
  pageBorder: "#d9dce3",
  header: "#f4f5f8",
  headerText: "#5f6472",
  headerLine: "#d5d8df",
  grid: "#e3e5ea",
  text: "#1f2328",
  accent: "#14b8a6",
} as const;

/** Inputs of {@link renderSheets}. */
export interface SheetRenderOptions {
  /** Stage width, px. */
  width: number;
  /** Layer budget for all sheets together. */
  maxLayers: number;
}

export interface SheetRenderResult {
  layers: Layer[];
  height: number;
  /** Non-empty cells left out by the layer budget or the stage width. */
  droppedCells: number;
  /** Sheets left out entirely by the layer budget. */
  droppedSheets: number;
}

interface Geometry {
  k: number;
  /** Visible column count after fitting to the stage width. */
  cols: number;
  /** Column/row edges in stage px (length count + 1). */
  xs: number[];
  ys: number[];
  rowHeaderW: number;
  colHeaderH: number;
  page: Rect;
}

function layout(sheet: SheetModel, width: number, pad: number, top: number): Geometry {
  const digits = String(Math.max(1, sheet.rows)).length;
  const rowHeaderNatural = Math.max(34, digits * 8 + 18);
  const avail = Math.max(120, width - 2 * pad);
  const natural = rowHeaderNatural + sheet.colWidths.reduce((a, b) => a + b, 0);
  let k = Math.min(MAX_SCALE, avail / Math.max(1, natural));
  let cols = sheet.cols;
  if (k < MIN_SCALE) {
    k = MIN_SCALE;
    let used = rowHeaderNatural * k;
    cols = 0;
    while (cols < sheet.cols && used + (sheet.colWidths[cols] ?? 0) * k <= avail) {
      used += (sheet.colWidths[cols] ?? 0) * k;
      cols++;
    }
    cols = Math.max(1, cols);
  }
  const rowHeaderW = rowHeaderNatural * k;
  const colHeaderH = COL_HEADER_H * k;
  const pageTop = top + TAB_H;
  const xs = [pad + rowHeaderW];
  for (let c = 0; c < cols; c++) xs.push((xs[c] as number) + (sheet.colWidths[c] ?? 0) * k);
  const ys = [pageTop + colHeaderH];
  for (let r = 0; r < sheet.rows; r++) ys.push((ys[r] as number) + (sheet.rowHeights[r] ?? 0) * k);
  const right = xs[cols] as number;
  const bottom = ys[sheet.rows] as number;
  return {
    k,
    cols,
    xs,
    ys,
    rowHeaderW,
    colHeaderH,
    page: { x: pad, y: pageTop, w: right - pad, h: bottom - pageTop },
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: round2(x0), y: round2(y0), w: round2(x1 - x0), h: round2(y1 - y0) };
}

const H = (n: number) => round2(n);

/** Emits the layers of one sheet. */
class SheetEmitter {
  private readonly base: number;
  private readonly id: string;
  private readonly merges: Merge[];
  /** Merge anchored at a cell (key r * cols + c) and cells covered by a merge but not its anchor. */
  private readonly mergeAt = new Map<number, Merge>();
  private readonly covered = new Set<number>();
  private readonly occupied = new Set<number>();
  /** Columns that got a snapping guide. */
  private readonly guided = new Set<number>();
  private readonly borderGroups = new Map<string, { side: BorderSide; d: string }>();
  droppedCells = 0;

  constructor(
    private readonly sheet: SheetModel,
    private readonly g: Geometry,
    index: number,
  ) {
    this.base = index * 10_000_000;
    this.id = `g${index + 1}`;
    this.merges = sheet.merges
      .filter((m) => m.c0 < g.cols && m.r0 < sheet.rows)
      .map((m) => ({ ...m, r1: Math.min(m.r1, sheet.rows - 1), c1: Math.min(m.c1, g.cols - 1) }));
    for (const m of this.merges) {
      this.mergeAt.set(this.key(m.r0, m.c0), m);
      for (let r = m.r0; r <= m.r1; r++) {
        for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) this.covered.add(this.key(r, c));
      }
    }
    for (const cell of sheet.cells) if (cell.text !== "") this.occupied.add(this.key(cell.row, cell.col));
  }

  private key(r: number, c: number): number {
    return r * 16384 + c;
  }

  private child<T extends Layer>(layer: T): T {
    layer.parent = `${this.id}-page`;
    layer.clip = this.g.page;
    layer.meta = { ...layer.meta, sheet: this.sheet.name };
    return layer;
  }

  /** Tab, page, header bars, grid and column letters (everything before the rows). */
  head(): Layer[] {
    const { g, sheet } = this;
    const out: Layer[] = [];
    const tabW = Math.min(260, Math.max(84, sheet.name.length * 7.5 + 36));
    const tab: Rect = { x: g.page.x, y: H(g.page.y - TAB_H + 1), w: H(tabW), h: TAB_H };
    out.push({
      id: `${this.id}-tab`,
      kind: "box",
      box: tab,
      role: "nav",
      priority: this.base,
      style: {
        background: PALETTE.page,
        border: `1px solid ${PALETTE.pageBorder}`,
        "border-bottom": "none",
        "border-top": `3px solid ${PALETTE.accent}`,
        "border-radius": "8px 8px 0 0",
      },
      meta: { sheet: sheet.name, label: `Sheet tab ${sheet.name}` },
    } satisfies BoxLayer);
    out.push({
      id: `${this.id}-tab-text`,
      kind: "text",
      box: tab,
      parent: `${this.id}-tab`,
      role: "heading",
      priority: this.base + 1,
      html: escapeHtml(sheet.name),
      text: sheet.name,
      fontSize: 12.5,
      reveal: "type",
      style: {
        "box-sizing": "border-box",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "0 12px",
        "font-family": fontStack("Segoe UI"),
        "font-size": "12.5px",
        "font-weight": "600",
        color: PALETTE.text,
        "white-space": "pre",
        overflow: "hidden",
        "text-overflow": "ellipsis",
      },
      meta: { sheet: sheet.name },
    } satisfies TextLayer);
    out.push({
      id: `${this.id}-page`,
      kind: "box",
      box: g.page,
      role: "page",
      priority: this.base + 2,
      style: {
        background: PALETTE.page,
        border: `1px solid ${PALETTE.pageBorder}`,
        "border-radius": "0 6px 6px 6px",
        "box-shadow": "0 1px 2px rgba(11, 11, 18, 0.06), 0 8px 24px rgba(11, 11, 18, 0.08)",
      },
      meta: { sheet: sheet.name, label: `Sheet ${sheet.name}`, rows: sheet.rows, cols: g.cols },
    } satisfies BoxLayer);
    const right = g.xs[g.cols] as number;
    const bottom = g.ys[sheet.rows] as number;
    const headerTop = g.page.y;
    const gridLeft = g.xs[0] as number;
    const gridTop = g.ys[0] as number;
    out.push(
      this.child<BoxLayer>({
        id: `${this.id}-colbar`,
        kind: "box",
        box: rect(gridLeft, headerTop, right, gridTop),
        role: "row",
        priority: this.base + 3,
        style: { background: PALETTE.header },
        meta: { header: "columns" },
      }),
      this.child<BoxLayer>({
        id: `${this.id}-rowbar`,
        kind: "box",
        box: rect(g.page.x, gridTop, gridLeft, bottom),
        priority: this.base + 4,
        style: { background: PALETTE.header },
        meta: { header: "rows" },
      }),
      this.child<BoxLayer>({
        id: `${this.id}-corner`,
        kind: "box",
        box: rect(g.page.x, headerTop, gridLeft, gridTop),
        priority: this.base + 5,
        style: { background: PALETTE.header, "border-top-left-radius": "0" },
      }),
    );
    out.push(...this.grid());
    for (let c = 0; c < g.cols; c++) {
      const x0 = g.xs[c] as number;
      const x1 = g.xs[c + 1] as number;
      if (x1 - x0 < 1) continue;
      out.push(
        this.headerLabel(`${this.id}-ch${c + 1}`, columnName(c), rect(x0, headerTop, x1, gridTop), this.base + 200 + c),
      );
    }
    out.push(...this.guides());
    return out;
  }

  private headerLabel(id: string, label: string, box: Rect, priority: number): TextLayer {
    const size = round2(11.5 * this.g.k);
    return this.child<TextLayer>({
      id,
      kind: "text",
      box,
      priority,
      html: escapeHtml(label),
      text: label,
      fontSize: size,
      reveal: "type",
      style: {
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "font-family": fontStack("Segoe UI"),
        "font-size": px(size),
        color: PALETTE.headerText,
        "white-space": "pre",
        overflow: "hidden",
      },
      meta: { header: true },
    });
  }

  /** Grid lines (merge-aware) and header separators as stroked paths, built first. */
  private grid(): PathLayer[] {
    const { g, sheet } = this;
    const out: PathLayer[] = [];
    const top = g.page.y;
    const left = g.page.x;
    const gridLeft = g.xs[0] as number;
    const gridTop = g.ys[0] as number;
    const right = g.xs[g.cols] as number;
    const bottom = g.ys[sheet.rows] as number;
    // Header separators: one tick per column/row boundary inside the bars.
    let hd = `M${H(left)} ${H(gridTop)}H${H(right)}M${H(gridLeft)} ${H(top)}V${H(bottom)}`;
    for (let c = 1; c <= g.cols; c++) hd += `M${H(g.xs[c] as number)} ${H(top)}V${H(gridTop)}`;
    for (let r = 1; r <= sheet.rows; r++) hd += `M${H(left)} ${H(g.ys[r] as number)}H${H(gridLeft)}`;
    if (sheet.showGrid && sheet.rows > 0 && g.cols > 0) {
      out.push(this.gridPath(`${this.id}-grid-v`, this.verticalLines(), 100));
      out.push(this.gridPath(`${this.id}-grid-h`, this.horizontalLines(), 101));
    }
    out.push(
      this.child<PathLayer>({
        id: `${this.id}-header-lines`,
        kind: "path",
        box: rect(left, top, right, bottom),
        priority: this.base + 102,
        d: hd,
        stroke: PALETTE.headerLine,
        strokeWidth: 1,
        fill: "none",
        attrs: { "shape-rendering": "crispEdges" },
        reveal: "trace",
      }),
    );
    return out;
  }

  private gridPath(id: string, d: string, offset: number): PathLayer {
    const { g, sheet } = this;
    return this.child<PathLayer>({
      id,
      kind: "path",
      box: rect(g.xs[0] as number, g.ys[0] as number, g.xs[g.cols] as number, g.ys[sheet.rows] as number),
      role: "table",
      priority: this.base + offset,
      d,
      stroke: PALETTE.grid,
      strokeWidth: 1,
      fill: "none",
      attrs: { "shape-rendering": "crispEdges" },
      reveal: "trace",
    });
  }

  /** True when the boundary between two cells lies inside one merged range. */
  private insideMerge(r0: number, c0: number, r1: number, c1: number): boolean {
    for (const m of this.merges) {
      if (r0 >= m.r0 && r1 <= m.r1 && c0 >= m.c0 && c1 <= m.c1) return true;
    }
    return false;
  }

  private verticalLines(): string {
    const { g, sheet } = this;
    let d = "";
    for (let c = 1; c <= g.cols; c++) {
      const x = H(g.xs[c] as number);
      let start: number | undefined;
      for (let r = 0; r <= sheet.rows; r++) {
        const open = r < sheet.rows && !(c < g.cols && this.insideMerge(r, c - 1, r, c));
        if (open && start === undefined) start = r;
        if (!open && start !== undefined) {
          d += `M${x} ${H(g.ys[start] as number)}V${H(g.ys[r] as number)}`;
          start = undefined;
        }
      }
    }
    return d;
  }

  private horizontalLines(): string {
    const { g, sheet } = this;
    let d = "";
    for (let r = 1; r <= sheet.rows; r++) {
      const y = H(g.ys[r] as number);
      let start: number | undefined;
      for (let c = 0; c <= g.cols; c++) {
        const open = c < g.cols && !(r < sheet.rows && this.insideMerge(r - 1, c, r, c));
        if (open && start === undefined) start = c;
        if (!open && start !== undefined) {
          d += `M${H(g.xs[start] as number)} ${y}H${H(g.xs[c] as number)}`;
          start = undefined;
        }
      }
    }
    return d;
  }

  /** Left text edges shared by the cells of busy columns, so typing snaps to them. */
  private guides(): GuideLayer[] {
    const { g, sheet } = this;
    const counts = new Array<number>(g.cols).fill(0);
    for (const cell of sheet.cells) {
      if (cell.col < g.cols && cell.text !== "" && this.align(cell) === "left")
        counts[cell.col] = (counts[cell.col] ?? 0) + 1;
    }
    const out: GuideLayer[] = [];
    for (let c = 0; c < g.cols; c++) {
      if ((counts[c] ?? 0) < 3) continue;
      this.guided.add(c);
      const pos = H((g.xs[c] as number) + CELL_PAD_X * g.k);
      out.push(
        this.child<GuideLayer>({
          id: `${this.id}-guide${c + 1}`,
          kind: "guide",
          axis: "x",
          pos,
          box: { x: pos, y: H(g.ys[0] as number), w: 0, h: H((g.ys[sheet.rows] as number) - (g.ys[0] as number)) },
          priority: this.base + 300 + c,
          meta: { column: columnName(c) },
        }),
      );
    }
    return out;
  }

  private align(cell: Cell): "left" | "center" | "right" | "justify" {
    if (cell.style?.hAlign) return cell.style.hAlign;
    if (cell.kind === "number") return "right";
    if (cell.kind === "boolean" || cell.kind === "error") return "center";
    return "left";
  }

  /** Layers of one row (row number, fills, texts), or an empty list when the row is blank. */
  row(r: number, cells: readonly Cell[]): Layer[] {
    const { g } = this;
    const out: Layer[] = [];
    const y0 = g.ys[r] as number;
    const y1 = g.ys[r + 1] as number;
    if (y1 - y0 < 1) return out;
    const rowBase = this.base + 1000 + r * (g.cols * 2 + 2);
    out.push(
      this.headerLabel(`${this.id}-rh${r + 1}`, String(r + 1), rect(g.page.x, y0, g.xs[0] as number, y1), rowBase),
    );
    const texts: Layer[] = [];
    for (const cell of cells) {
      const c = cell.col;
      if (c >= g.cols) {
        if (cell.text !== "") this.droppedCells++;
        continue;
      }
      const k = this.key(r, c);
      if (this.covered.has(k)) continue;
      const merge = this.mergeAt.get(k);
      const box = merge
        ? rect(g.xs[c] as number, y0, g.xs[merge.c1 + 1] as number, g.ys[merge.r1 + 1] as number)
        : rect(g.xs[c] as number, y0, g.xs[c + 1] as number, y1);
      if (box.w < 1 || box.h < 1) continue;
      const ref = `${columnName(c)}${r + 1}`;
      if (cell.style?.fill) {
        out.push(
          this.child<BoxLayer>({
            id: `${this.id}-f${ref}`,
            kind: "box",
            box,
            role: "cell",
            priority: rowBase + 1 + c * 2,
            style: { background: cell.style.fill },
            meta: { row: r + 1, col: c + 1, ref, fill: true },
          }),
        );
      }
      if (cell.text !== "")
        texts.push(this.cellText(cell, ref, merge ? box : this.overflowBox(cell, box), rowBase + 2 + c * 2));
      this.borders(cell, box);
    }
    out.push(...texts);
    return out;
  }

  /**
   * Unwrapped single-line text spills into empty neighbours like in a spreadsheet: left-aligned
   * text to the right, right-aligned text (numbers, dates) to the left. Spreadsheet apps show
   * "###" for numbers that do not fit; showing the value is more useful here.
   */
  private overflowBox(cell: Cell, box: Rect): Rect {
    const { g } = this;
    const align = this.align(cell);
    if (cell.style?.wrap || cell.text.includes("\n") || (align !== "left" && align !== "right")) return box;
    if (align === "left" && cell.kind !== "string" && cell.kind !== "formula") return box;
    const size = (cell.style?.fontSize ?? this.sheet.fontSize) * PT_TO_PX * g.k;
    // Rough advance widths: digits are wider than average letters in most UI fonts.
    const perChar = cell.kind === "number" ? 0.62 : 0.56;
    const needed = cell.text.length * size * perChar + 2 * CELL_PAD_X * g.k;
    if (box.w >= needed) return box;
    const free = (col: number): boolean => {
      const k = this.key(cell.row, col);
      return !this.occupied.has(k) && !this.covered.has(k) && !this.mergeAt.has(k);
    };
    let c = cell.col;
    if (align === "left") {
      let right = box.x + box.w;
      while (right - box.x < needed && c + 1 < g.cols && free(c + 1)) {
        c++;
        right = g.xs[c + 1] as number;
      }
      return { ...box, w: round2(right - box.x) };
    }
    const right = box.x + box.w;
    let left = box.x;
    while (right - left < needed && c - 1 >= 0 && free(c - 1)) {
      c--;
      left = g.xs[c] as number;
    }
    return { ...box, x: round2(left), w: round2(right - left) };
  }

  private cellText(cell: Cell, ref: string, box: Rect, priority: number): TextLayer {
    const { g, sheet } = this;
    const st = cell.style ?? {};
    const fontPx = round2((st.fontSize ?? sheet.fontSize) * PT_TO_PX * g.k);
    const align = this.align(cell);
    const wrap = st.wrap === true || cell.text.includes("\n");
    const v = st.vAlign ?? "bottom";
    const indent = (st.indent ?? 0) * INDENT_PX * g.k;
    const style: CSSMap = {
      "box-sizing": "border-box",
      display: "flex",
      "flex-direction": "column",
      "justify-content": v === "top" ? "flex-start" : v === "middle" ? "center" : "flex-end",
      padding: `${px(1 * g.k)} ${px(CELL_PAD_X * g.k + (align === "right" ? indent : 0))} ${px(2 * g.k)} ${px(
        CELL_PAD_X * g.k + (align === "right" ? 0 : indent),
      )}`,
      "font-family": fontStack(st.font ?? sheet.font),
      "font-size": px(fontPx),
      "line-height": "1.2",
      color: st.color ?? PALETTE.text,
      "text-align": align,
      "white-space": wrap ? "pre-wrap" : "pre",
      "overflow-wrap": "break-word",
      overflow: "hidden",
    };
    if (st.bold) style["font-weight"] = "700";
    if (st.italic) style["font-style"] = "italic";
    const deco = [st.underline ? "underline" : "", st.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) style["text-decoration"] = deco;
    if (cell.kind === "number") style["font-variant-numeric"] = "tabular-nums";
    const header = sheet.headerRow === cell.row;
    const meta: Record<string, unknown> = { row: cell.row + 1, col: cell.col + 1, ref, kind: cell.kind };
    if (header) meta.header = true;
    return this.child<TextLayer>({
      id: `${this.id}-c${ref}`,
      kind: "text",
      box,
      role: "cell",
      priority,
      html: escapeHtml(cell.text),
      text: cell.text,
      fontSize: fontPx,
      reveal: "type",
      style,
      snaps: align === "left" && !indent && this.guided.has(cell.col) ? [`${this.id}-guide${cell.col + 1}`] : undefined,
      meta,
    });
  }

  private borders(cell: Cell, box: Rect): void {
    const b = cell.style?.borders;
    if (!b) return;
    const x0 = box.x;
    const y0 = box.y;
    const x1 = box.x + box.w;
    const y1 = box.y + box.h;
    const add = (side: BorderSide | undefined, d: string) => {
      if (!side) return;
      const key = `${side.color}|${side.width}|${side.style}`;
      const group = this.borderGroups.get(key) ?? { side, d: "" };
      group.d += d;
      this.borderGroups.set(key, group);
    };
    add(b.t, `M${H(x0)} ${H(y0)}H${H(x1)}`);
    add(b.b, `M${H(x0)} ${H(y1)}H${H(x1)}`);
    add(b.l, `M${H(x0)} ${H(y0)}V${H(y1)}`);
    add(b.r, `M${H(x1)} ${H(y0)}V${H(y1)}`);
  }

  /** Explicit cell borders, grouped by stroke, painted above fills and built with the grid. */
  finishBorders(): PathLayer[] {
    const { g, sheet } = this;
    const out: PathLayer[] = [];
    let i = 0;
    const box = rect(g.xs[0] as number, g.ys[0] as number, g.xs[g.cols] as number, g.ys[sheet.rows] as number);
    for (const { side, d } of this.borderGroups.values()) {
      const attrs: Record<string, string> = { "stroke-linecap": "square" };
      if (side.style === "dashed") attrs["stroke-dasharray"] = `${3 * side.width} ${2 * side.width}`;
      if (side.style === "dotted") attrs["stroke-dasharray"] = `${side.width} ${side.width}`;
      out.push(
        this.child<PathLayer>({
          id: `${this.id}-border${++i}`,
          kind: "path",
          box,
          role: "table",
          priority: this.base + 110 + i,
          d,
          stroke: side.color,
          strokeWidth: round2(Math.max(1, side.width * Math.min(1, g.k))),
          fill: "none",
          attrs,
          reveal: "trace",
        }),
      );
    }
    return out;
  }
}

/**
 * Lays out sheets one below the other (tab, header bars, grid, cells) at the stage width and
 * returns their layers, honouring the layer budget by cutting whole rows (then whole sheets).
 */
export function renderSheets(sheets: readonly SheetModel[], options: SheetRenderOptions): SheetRenderResult {
  const pad = Math.min(40, Math.max(16, Math.round(options.width * 0.03)));
  const layers: Layer[] = [];
  let top = pad;
  let droppedCells = 0;
  let droppedSheets = 0;
  for (const [index, sheet] of sheets.entries()) {
    if (layers.length >= options.maxLayers) {
      droppedSheets = sheets.length - index;
      break;
    }
    // Fit the row count to the remaining budget before laying out, so the page is exact.
    const fitted = fitRows(sheet, options.maxLayers - layers.length);
    const g = layout(fitted.sheet, options.width, pad, top);
    const emitter = new SheetEmitter(fitted.sheet, g, index);
    layers.push(...emitter.head());
    const byRow = groupRows(fitted.sheet.cells);
    for (let r = 0; r < fitted.sheet.rows; r++) layers.push(...emitter.row(r, byRow.get(r) ?? []));
    layers.push(...emitter.finishBorders());
    if (layers.length > options.maxLayers) {
      // Border groups are estimated; never exceed the budget (parents precede children, so a prefix is valid).
      for (const cut of layers.splice(options.maxLayers))
        if (cut.kind === "text" && cut.role === "cell") droppedCells++;
    }
    droppedCells += fitted.dropped + emitter.droppedCells;
    top = g.page.y + g.page.h + SHEET_GAP;
  }
  return { layers, height: Math.ceil(top - SHEET_GAP + pad), droppedCells, droppedSheets };
}

function groupRows(cells: readonly Cell[]): Map<number, Cell[]> {
  const out = new Map<number, Cell[]>();
  for (const cell of cells) {
    const list = out.get(cell.row);
    if (list) list.push(cell);
    else out.set(cell.row, [cell]);
  }
  for (const list of out.values()) list.sort((a, b) => a.col - b.col);
  return out;
}

/** Upper bound of layers a sheet needs besides its cells (chrome, grid, letters, guides, borders). */
function fixedLayers(sheet: SheetModel): number {
  return 16 + 3 * sheet.cols;
}

/** Cuts trailing rows until the sheet fits `budget` layers (at least one row is kept). */
function fitRows(sheet: SheetModel, budget: number): { sheet: SheetModel; dropped: number } {
  const perRow = new Array<number>(sheet.rows).fill(1);
  for (const cell of sheet.cells) {
    if (cell.row < sheet.rows)
      perRow[cell.row] = (perRow[cell.row] ?? 1) + (cell.text ? 1 : 0) + (cell.style?.fill ? 1 : 0);
  }
  let used = fixedLayers(sheet);
  let rows = 0;
  while (rows < sheet.rows && used + (perRow[rows] ?? 1) <= budget) used += perRow[rows++] ?? 1;
  rows = Math.max(1, Math.min(rows, sheet.rows));
  if (rows >= sheet.rows) return { sheet, dropped: 0 };
  const kept = sheet.cells.filter((c) => c.row < rows);
  const dropped = sheet.cells.filter((c) => c.row >= rows && c.text !== "").length;
  return {
    sheet: {
      ...sheet,
      cells: kept,
      rows,
      rowHeights: sheet.rowHeights.slice(0, rows),
      merges: sheet.merges.filter((m) => m.r0 < rows).map((m) => ({ ...m, r1: Math.min(m.r1, rows - 1) })),
    },
    dropped,
  };
}
