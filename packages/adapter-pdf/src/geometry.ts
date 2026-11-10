/**
 * Small 2D helpers shared by the text, operator and coverage passes.
 *
 * Matrices follow the pdf.js / canvas convention `[a, b, c, d, e, f]`:
 * a point maps to `(a*x + c*y + e, b*x + d*y + f)`.
 */

export type Matrix = readonly [number, number, number, number, number, number];

/** Axis-aligned box as edges (easier to union and intersect than x/y/w/h). */
export interface Edges {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m1 * m2`: applies `m2` first, then `m1` (same as pdf.js `Util.transform`). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Reads six finite numbers from an untrusted array; null when it is not a matrix. */
export function toMatrix(value: unknown): Matrix | null {
  if (!value || typeof (value as ArrayLike<number>).length !== "number") return null;
  const v = value as ArrayLike<unknown>;
  if (v.length < 6) return null;
  const out = [v[0], v[1], v[2], v[3], v[4], v[5]];
  return out.every((n) => typeof n === "number" && Number.isFinite(n)) ? (out as unknown as Matrix) : null;
}

/** Uniform scale factor of a matrix (geometric mean of its axis scales). */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function emptyEdges(): Edges {
  return {
    x0: Number.POSITIVE_INFINITY,
    y0: Number.POSITIVE_INFINITY,
    x1: Number.NEGATIVE_INFINITY,
    y1: Number.NEGATIVE_INFINITY,
  };
}

export function isEmpty(e: Edges): boolean {
  return !(e.x1 > e.x0 && e.y1 > e.y0);
}

/** Grows `into` to include the point (mutates and returns it). */
export function addPoint(into: Edges, x: number, y: number): Edges {
  if (x < into.x0) into.x0 = x;
  if (y < into.y0) into.y0 = y;
  if (x > into.x1) into.x1 = x;
  if (y > into.y1) into.y1 = y;
  return into;
}

/** Axis-aligned bounds of the box `[x0, y0, x1, y1]` after transforming its four corners. */
export function transformBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): Edges {
  const out = emptyEdges();
  addPoint(out, m[0] * x0 + m[2] * y0 + m[4], m[1] * x0 + m[3] * y0 + m[5]);
  addPoint(out, m[0] * x1 + m[2] * y0 + m[4], m[1] * x1 + m[3] * y0 + m[5]);
  addPoint(out, m[0] * x0 + m[2] * y1 + m[4], m[1] * x0 + m[3] * y1 + m[5]);
  addPoint(out, m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5]);
  return out;
}

export function intersect(a: Edges, b: Edges): Edges {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

export function union(a: Edges, b: Edges): Edges {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function expand(e: Edges, dx: number, dy = dx): Edges {
  return { x0: e.x0 - dx, y0: e.y0 - dy, x1: e.x1 + dx, y1: e.y1 + dy };
}

export function area(e: Edges): number {
  return isEmpty(e) ? 0 : (e.x1 - e.x0) * (e.y1 - e.y0);
}

/** True when the boxes overlap or touch within `gap`. */
export function near(a: Edges, b: Edges, gap = 0): boolean {
  return a.x0 <= b.x1 + gap && b.x0 <= a.x1 + gap && a.y0 <= b.y1 + gap && b.y0 <= a.y1 + gap;
}

/** Share of `inner` that lies inside `outer`, 0..1. */
export function coverage(inner: Edges, outer: Edges): number {
  const a = area(inner);
  return a > 0 ? area(intersect(inner, outer)) / a : 0;
}

/**
 * Merges boxes that overlap or touch within `gap` until no pair does.
 * Keeps the index of the earliest member of each group (paint order).
 */
export function mergeNear<T extends { edges: Edges; order: number }>(
  items: readonly T[],
  gap: number,
): { edges: Edges; order: number }[] {
  const groups = items.map((i) => ({ edges: { ...i.edges }, order: i.order }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length; i++) {
      const a = groups[i] as { edges: Edges; order: number };
      for (let j = groups.length - 1; j > i; j--) {
        const b = groups[j] as { edges: Edges; order: number };
        if (!near(a.edges, b.edges, gap)) continue;
        a.edges = union(a.edges, b.edges);
        a.order = Math.min(a.order, b.order);
        groups.splice(j, 1);
        merged = true;
      }
    }
  }
  return groups.sort((a, b) => a.order - b.order);
}
