import { TripleTable } from "./hash";

/** Welded topology of triangle soups. */
export interface Welded {
  /** Welded vertex id per corner (soups concatenated in order, 3 corners per triangle). */
  corner: Uint32Array;
  /** 3 floats per welded vertex: the position of its first corner. */
  positions: Float32Array;
  count: number;
}

/**
 * Merges corners whose positions quantize to the same cell of size `tolerance`.
 *
 * STL and flat-shaded exports store every triangle separately; welding recovers the shared
 * vertices needed for adjacency, feature edges and vertex points. Positions are expected in
 * normalized model space (|p| <= ~1), so `tolerance` around 1e-5..1e-4 keeps cell indices small.
 */
export function weldCorners(sources: readonly Float32Array[], tolerance: number): Welded {
  if (!(tolerance > 0)) throw new RangeError("weld tolerance must be > 0");
  let corners = 0;
  for (const p of sources) corners += p.length / 3;
  const corner = new Uint32Array(corners);
  const table = new TripleTable(corners);
  const scratch = new Float32Array(corners * 3);
  const inv = 1 / tolerance;
  let c = 0;
  for (const p of sources) {
    for (let i = 0; i < p.length; i += 3, c++) {
      const x = p[i] as number;
      const y = p[i + 1] as number;
      const z = p[i + 2] as number;
      const before = table.size;
      const id = table.idOf(Math.round(x * inv), Math.round(y * inv), Math.round(z * inv));
      if (id === before) {
        scratch[id * 3] = x;
        scratch[id * 3 + 1] = y;
        scratch[id * 3 + 2] = z;
      }
      corner[c] = id;
    }
  }
  const count = table.size;
  return { corner, positions: scratch.slice(0, count * 3), count };
}
