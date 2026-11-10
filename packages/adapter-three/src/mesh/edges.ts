import { TripleTable } from "./hash";

/** Unique undirected edges of a welded triangle mesh. */
export interface EdgeList {
  count: number;
  /** Welded vertex ids, a < b. */
  a: Uint32Array;
  b: Uint32Array;
  /** First triangle that uses the edge (owner for patch assignment). */
  face: Uint32Array;
  /** Dihedral angle in radians; PI for boundary and non-manifold edges. */
  angle: Float32Array;
}

/**
 * Builds the unique edge list with dihedral angles from welded corners and face normals.
 * Degenerate triangles (two corners on one vertex) contribute no edges.
 */
export function buildEdges(corner: Uint32Array, faceNormals: Float32Array): EdgeList {
  const triangles = Math.floor(corner.length / 3);
  const capacity = triangles * 3;
  const table = new TripleTable(capacity);
  const a = new Uint32Array(capacity);
  const b = new Uint32Array(capacity);
  const face = new Uint32Array(capacity);
  const uses = new Uint8Array(capacity);
  const minDot = new Float32Array(capacity);
  for (let t = 0; t < triangles; t++) {
    for (let e = 0; e < 3; e++) {
      const u = corner[t * 3 + e] as number;
      const v = corner[t * 3 + ((e + 1) % 3)] as number;
      if (u === v) continue;
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const before = table.size;
      const id = table.idOf(lo, hi, 0);
      if (id === before) {
        a[id] = lo;
        b[id] = hi;
        face[id] = t;
        uses[id] = 1;
        minDot[id] = 1;
        continue;
      }
      const n = uses[id] as number;
      if (n < 255) uses[id] = n + 1;
      const f = face[id] as number;
      const dot =
        (faceNormals[f * 3] as number) * (faceNormals[t * 3] as number) +
        (faceNormals[f * 3 + 1] as number) * (faceNormals[t * 3 + 1] as number) +
        (faceNormals[f * 3 + 2] as number) * (faceNormals[t * 3 + 2] as number);
      if (dot < (minDot[id] as number)) minDot[id] = dot;
    }
  }
  const count = table.size;
  const angle = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    angle[i] = uses[i] === 2 ? Math.acos(Math.max(-1, Math.min(1, minDot[i] as number))) : Math.PI;
  }
  return { count, a: a.slice(0, count), b: b.slice(0, count), face: face.slice(0, count), angle };
}

/**
 * Chooses the edges worth drawing: boundaries and creases first (largest dihedral angle),
 * skipping near-coplanar diagonals below `minAngle`, at most `budget` of them.
 * Returns edge indices in ascending order (stable, deterministic).
 */
export function pickEdges(edges: EdgeList, budget: number, minAngle: number): Uint32Array {
  const candidates: number[] = [];
  for (let i = 0; i < edges.count; i++) if ((edges.angle[i] as number) >= minAngle) candidates.push(i);
  if (candidates.length > budget) {
    candidates.sort((x, y) => (edges.angle[y] as number) - (edges.angle[x] as number) || x - y);
    candidates.length = Math.max(0, budget);
  }
  return Uint32Array.from(candidates).sort();
}
