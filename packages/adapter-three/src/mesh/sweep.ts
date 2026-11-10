/**
 * Screen-space sweep used to order a patch's vertices, edges and triangles so they appear
 * in the same zig-zag the building cursor follows (row by row, alternating direction).
 */

/** Axis-aligned box in stage px. */
export interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A sweep waypoint: stage position and the reveal fraction reached there. */
export interface SweepPoint {
  x: number;
  y: number;
  p: number;
}

/** Number of sweep rows for a box: about one per `rowHeight` px, at least 1, at most `maxRows`. */
export function sweepRows(box: Box2, rowHeight = 48, maxRows = 3): number {
  const h = box.y1 - box.y0;
  return Math.max(1, Math.min(maxRows, Math.round(h / rowHeight)));
}

/** Fraction 0..1 at which the sweep over `box` with `rows` rows passes the point (x, y). */
export function sweepParam(x: number, y: number, box: Box2, rows: number): number {
  const w = Math.max(box.x1 - box.x0, 1e-6);
  const h = Math.max(box.y1 - box.y0, 1e-6);
  const fy = Math.min(Math.max((y - box.y0) / h, 0), 0.999999);
  const row = Math.floor(fy * rows);
  let fx = Math.min(Math.max((x - box.x0) / w, 0), 1);
  if (row % 2 === 1) fx = 1 - fx;
  return (row + fx) / rows;
}

/** Waypoints of the sweep: each row is traversed end to end, alternating direction. */
export function sweepPath(box: Box2, rows: number): SweepPoint[] {
  const h = box.y1 - box.y0;
  const path: SweepPoint[] = [];
  for (let row = 0; row < rows; row++) {
    const y = box.y0 + ((row + 0.5) / rows) * h;
    const [from, to] = row % 2 === 0 ? [box.x0, box.x1] : [box.x1, box.x0];
    path.push({ x: from, y, p: row / rows }, { x: to, y, p: (row + 1) / rows });
  }
  return path;
}

/**
 * Converts sort keys into reveal orders: the item with rank r (stable by index on ties) gets
 * (r + 1) / n, so revealing up to p shows exactly the first round(p * n) items.
 */
export function rankOrders(keys: ArrayLike<number>, out: Float32Array, at = 0): void {
  const n = keys.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => (keys[a] as number) - (keys[b] as number) || a - b);
  for (let r = 0; r < n; r++) out[at + (idx[r] as number)] = (r + 1) / n;
}
