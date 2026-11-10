import { parseCsv } from "./csv";
import {
  type Cell,
  DEFAULT_ROW_HEIGHT,
  detectHeaderRow,
  looksNumeric,
  type SheetLimits,
  type SheetModel,
} from "./model";

/** Approximate average glyph width of 11pt sans text, px (used to size columns to content). */
const CHAR_PX = 7;
const MIN_COL = 48;
const MAX_COL = 320;
const LINE_PX = 17;
const MAX_ROW = 120;

/**
 * Builds a sheet from delimited text: column widths fit the content (within bounds), numeric
 * fields are typed as numbers so they align right, and a header row is detected.
 */
export function delimitedSheet(text: string, name: string, limits: SheetLimits, delimiter?: string): SheetModel {
  const parsed = parseCsv(text, { delimiter, maxRows: limits.maxRows, maxCols: limits.maxCols });
  const cells: Cell[] = [];
  let cols = 0;
  const widest: number[] = [];
  const lines: number[] = [];
  parsed.rows.forEach((fields, row) => {
    let rowLines = 1;
    fields.forEach((value, col) => {
      if (value === "") return;
      cells.push({ row, col, text: value, kind: looksNumeric(value) ? "number" : "string" });
      cols = Math.max(cols, col + 1);
      const valueLines = value.split(/\r\n|\r|\n/);
      rowLines = Math.max(rowLines, valueLines.length);
      for (const line of valueLines) widest[col] = Math.max(widest[col] ?? 0, line.length);
    });
    lines[row] = rowLines;
  });
  const rows = parsed.rows.length;
  const headerRow = detectHeaderRow(cells);
  if (headerRow !== undefined) {
    for (const cell of cells) if (cell.row === headerRow) cell.style = { bold: true };
  }
  return {
    name,
    cells,
    rows,
    cols,
    colWidths: Array.from({ length: cols }, (_, c) =>
      Math.min(MAX_COL, Math.max(MIN_COL, Math.round((widest[c] ?? 0) * CHAR_PX + 16))),
    ),
    rowHeights: Array.from({ length: rows }, (_, r) =>
      Math.min(MAX_ROW, Math.max(DEFAULT_ROW_HEIGHT, (lines[r] ?? 1) * LINE_PX + 4)),
    ),
    merges: [],
    showGrid: true,
    fontSize: 11,
    font: "Calibri",
    droppedCells: parsed.droppedFields,
    usedRows: parsed.totalRows,
    usedCols: parsed.totalCols,
    headerRow,
  };
}
