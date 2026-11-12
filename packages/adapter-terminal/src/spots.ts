/**
 * Spots on a terminal screen where a cursor covers no text: right of the text on every row its
 * art, name tag and status bubble reach. Used for cursors that watch output and for idle ones.
 */

import type { Screen } from "./screen";

/** How far a cursor reaches from its hotspot, stage px: up, down and to the right. */
export interface Reach {
  up: number;
  down: number;
  right: number;
}

/** A cursor watching output: its status bubble above right, its art and name tag below right. */
export const WATCH_REACH: Reach = { up: 30, down: 36, right: 60 };
/** An idle cursor: no bubble, only its art and name tag below right. */
export const REST_REACH: Reach = { up: 4, down: 36, right: 60 };

/** Cell grid of a screen, stage px. */
export interface Grid {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

/** A point in cell units (column, row) from the screen's top-left corner. */
export interface CellPoint {
  x: number;
  y: number;
}

/** Columns each row's text takes (0 for a blank row). */
export function rowEnds(screen: Screen): number[] {
  const ends: number[] = [];
  for (let y = 0; y < screen.rows; y++) ends.push(screen.runs(y).reduce((n, run) => n + run.cols, 0));
  return ends;
}

/** First and last row a cursor resting in the middle of row `y` reaches (may lie outside the screen). */
function rowsReached(g: Grid, reach: Reach, y: number): [number, number] {
  const cy = (y + 0.5) * g.cellH;
  return [Math.floor((cy - reach.up) / g.cellH), Math.floor((cy + reach.down) / g.cellH)];
}

/**
 * Column (one blank column after the text of every row it reaches) where a cursor resting in the
 * middle of row `y` covers no text, or -1 when the rest of those rows is too narrow for it.
 */
export function clearColumn(ends: readonly number[], g: Grid, reach: Reach, y: number): number {
  const [top, bottom] = rowsReached(g, reach, y);
  let end = 0;
  for (let r = Math.max(0, top); r <= Math.min(g.rows - 1, bottom); r++) end = Math.max(end, ends[r] ?? 0);
  const col = end + 1;
  return (g.cols - col) * g.cellW >= reach.right ? col : -1;
}

/**
 * Where a cursor watches output: right of the text on the nearest clear row that stays above the
 * text cursor's row (output lands from there down), else on the first clear row from it down, or
 * null when no row is clear.
 */
export function watchCell(ends: readonly number[], g: Grid, cursorRow: number): CellPoint | null {
  for (let y = Math.min(cursorRow, g.rows) - 1; y >= 0; y--) {
    const col = clearColumn(ends, g, WATCH_REACH, y);
    if (col >= 0 && rowsReached(g, WATCH_REACH, y)[1] < cursorRow) return { x: col, y: y + 0.5 };
  }
  for (let y = Math.max(0, cursorRow); y < g.rows; y++) {
    const col = clearColumn(ends, g, WATCH_REACH, y);
    if (col >= 0) return { x: col, y: y + 0.5 };
  }
  return null;
}

/**
 * Where an idle cursor rests: a clear spot on a random row that does not reach the text cursor's
 * row, at a random column of the free part. Rows above it come first: output lands below it next.
 * Null when there is none.
 */
export function restCell(ends: readonly number[], g: Grid, cursorRow: number, rng: () => number): CellPoint | null {
  const above: number[] = [];
  const below: number[] = [];
  for (let y = 0; y < g.rows; y++) {
    const [top, bottom] = rowsReached(g, REST_REACH, y);
    if (clearColumn(ends, g, REST_REACH, y) < 0) continue;
    if (bottom < cursorRow) above.push(y);
    else if (top > cursorRow) below.push(y);
  }
  const rows = above.length > 0 ? above : below;
  if (rows.length === 0) return null;
  const y = rows[Math.min(rows.length - 1, Math.floor(rng() * rows.length))] as number;
  const col = clearColumn(ends, g, REST_REACH, y);
  const slack = Math.max(0, g.cols - col - REST_REACH.right / g.cellW);
  return { x: col + rng() * slack, y: y + 0.5 };
}
