/**
 * Format-neutral spreadsheet model shared by the CSV/TSV, XLSX and ODS readers and the renderer.
 * Sizes are CSS px at 100% zoom; text is already formatted for display.
 */

export type CellKind = "string" | "number" | "boolean" | "error" | "formula";

export interface BorderSide {
  /** Line width, px. */
  width: number;
  color: string;
  style: "solid" | "dashed" | "dotted" | "double";
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** CSS colours. */
  color?: string;
  fill?: string;
  /** Font size, pt. */
  fontSize?: number;
  font?: string;
  hAlign?: "left" | "center" | "right" | "justify";
  vAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  indent?: number;
  borders?: { l?: BorderSide; r?: BorderSide; t?: BorderSide; b?: BorderSide };
}

export interface Cell {
  /** 0-based position. */
  row: number;
  col: number;
  /** Display text (formatted number, shared string, `=FORMULA` when no cached value...). */
  text: string;
  kind: CellKind;
  style?: CellStyle;
}

export interface Merge {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface SheetModel {
  name: string;
  /** Non-empty (or styled) cells inside the kept range, row-major. */
  cells: Cell[];
  /** Kept range size (after limits). */
  rows: number;
  cols: number;
  /** Column widths and row heights for the kept range, px. */
  colWidths: number[];
  rowHeights: number[];
  merges: Merge[];
  showGrid: boolean;
  /** Default font of the workbook, pt and family. */
  fontSize: number;
  font: string;
  /** Non-empty cells outside the kept range. */
  droppedCells: number;
  /** Full used range before limits. */
  usedRows: number;
  usedCols: number;
  /** 0-based row index of a detected header row. */
  headerRow?: number;
}

export interface WorkbookModel {
  sheets: SheetModel[];
  /** Sheets not read because of the sheet limit. */
  droppedSheets: number;
}

/** Limits applied while reading, so huge files never become huge models. */
export interface SheetLimits {
  maxRows: number;
  maxCols: number;
  maxSheets: number;
}

export const DEFAULT_SHEET_LIMITS: SheetLimits = { maxRows: 200, maxCols: 30, maxSheets: 3 };

/** Excel's default column width (8.43 characters of Calibri 11) and row height (15pt), px. */
export const DEFAULT_COL_WIDTH = 64;
export const DEFAULT_ROW_HEIGHT = 20;

/** 0-based column index -> letters (0 -> A, 26 -> AA). */
export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Parses an A1 reference ("$B$12" -> {row: 11, col: 1}). Returns undefined when malformed. */
export function parseRef(ref: string): { row: number; col: number } | undefined {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!m?.[1] || !m[2]) return undefined;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  return row >= 1 ? { row: row - 1, col: col - 1 } : undefined;
}

/** Parses "A1:C3" (or a single reference) into an inclusive range. */
export function parseRange(ref: string): Merge | undefined {
  const [a, b] = ref.split(":");
  const start = a ? parseRef(a) : undefined;
  const end = b ? parseRef(b) : start;
  if (!start || !end) return undefined;
  return {
    r0: Math.min(start.row, end.row),
    c0: Math.min(start.col, end.col),
    r1: Math.max(start.row, end.row),
    c1: Math.max(start.col, end.col),
  };
}

const NUMERIC = /^[+-]?(?:[$€£¥]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?%?$/;

/** True when display text looks like a number (used to right-align plain-text sources). */
export function looksNumeric(text: string): boolean {
  const t = text.trim();
  return t !== "" && /\d/.test(t) && NUMERIC.test(t);
}

/**
 * Detects a header row: the first row with two or more cells, all non-numeric text,
 * followed (within the next three rows) by a row that contains a number.
 */
export function detectHeaderRow(cells: readonly Cell[]): number | undefined {
  const byRow = new Map<number, Cell[]>();
  for (const c of cells) {
    if (!c.text) continue;
    const list = byRow.get(c.row) ?? [];
    list.push(c);
    byRow.set(c.row, list);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (let i = 0; i < rows.length && i < 10; i++) {
    const row = rows[i] as number;
    const list = byRow.get(row) ?? [];
    if (list.length < 2 || list.some((c) => c.kind !== "string" || looksNumeric(c.text))) continue;
    for (let j = i + 1; j < rows.length && j <= i + 3; j++) {
      const next = byRow.get(rows[j] as number) ?? [];
      if (next.some((c) => c.kind === "number" || c.kind === "formula" || looksNumeric(c.text))) return row;
    }
    return undefined;
  }
  return undefined;
}
