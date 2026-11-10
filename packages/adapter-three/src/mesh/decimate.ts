import { type FaceSoup, triangleCount } from "./soup";

/** Outcome of {@link decimateSoups}. */
export interface DecimateResult {
  soups: FaceSoup[];
  before: number;
  after: number;
  /** Grid resolution along the longest axis (0 when nothing was decimated). */
  resolution: number;
}

interface Grid {
  minX: number;
  minY: number;
  minZ: number;
  inv: number;
}

function cellOf(grid: Grid, x: number, y: number, z: number, res: number): number {
  const qx = Math.min(res - 1, Math.floor((x - grid.minX) * grid.inv));
  const qy = Math.min(res - 1, Math.floor((y - grid.minY) * grid.inv));
  const qz = Math.min(res - 1, Math.floor((z - grid.minZ) * grid.inv));
  return qx + res * (qy + res * qz);
}

function keptAt(soups: readonly FaceSoup[], bounds: Grid & { extent: number }, res: number): number {
  const grid = { ...bounds, inv: res / bounds.extent };
  let kept = 0;
  for (const soup of soups) {
    const p = soup.positions;
    for (let i = 0; i < p.length; i += 9) {
      const a = cellOf(grid, p[i] as number, p[i + 1] as number, p[i + 2] as number, res);
      const b = cellOf(grid, p[i + 3] as number, p[i + 4] as number, p[i + 5] as number, res);
      const c = cellOf(grid, p[i + 6] as number, p[i + 7] as number, p[i + 8] as number, res);
      if (a !== b && b !== c && a !== c) kept++;
    }
  }
  return kept;
}

/**
 * Vertex-clustering decimation: snaps corners to the mean of their grid cell and drops
 * triangles that collapse or duplicate. The grid resolution is the finest one (binary search)
 * that keeps at most `budget` triangles. Deterministic; attributes other than position are
 * kept from the original corners. Returns the input unchanged when it already fits.
 */
export function decimateSoups(soups: readonly FaceSoup[], budget: number): DecimateResult {
  let before = 0;
  for (const soup of soups) before += triangleCount(soup);
  if (before <= budget) return { soups: [...soups], before, after: before, resolution: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const soup of soups) {
    const p = soup.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] as number;
      const y = p[i + 1] as number;
      const z = p[i + 2] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9) * (1 + 1e-6);
  const bounds = { minX, minY, minZ, inv: 0, extent };

  let lo = 2;
  let hi = 4096;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (keptAt(soups, bounds, mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  const res = lo;
  const grid = { ...bounds, inv: res / extent };

  // Mean position per occupied cell.
  const cellIndex = new Map<number, number>();
  const sums: number[] = [];
  for (const soup of soups) {
    const p = soup.positions;
    for (let i = 0; i < p.length; i += 3) {
      const key = cellOf(grid, p[i] as number, p[i + 1] as number, p[i + 2] as number, res);
      let id = cellIndex.get(key);
      if (id === undefined) {
        id = cellIndex.size;
        cellIndex.set(key, id);
        sums.push(0, 0, 0, 0);
      }
      sums[id * 4] = (sums[id * 4] as number) + (p[i] as number);
      sums[id * 4 + 1] = (sums[id * 4 + 1] as number) + (p[i + 1] as number);
      sums[id * 4 + 2] = (sums[id * 4 + 2] as number) + (p[i + 2] as number);
      sums[id * 4 + 3] = (sums[id * 4 + 3] as number) + 1;
    }
  }

  let after = 0;
  const out: FaceSoup[] = [];
  for (const soup of soups) {
    const p = soup.positions;
    const keep: number[] = [];
    const ids: number[] = [];
    const seen = new Set<string>();
    // The coarsest grid can still exceed tiny budgets; the cap keeps the bound strict.
    for (let t = 0; t < p.length / 9 && after + keep.length < budget; t++) {
      const i = t * 9;
      const a = cellIndex.get(cellOf(grid, p[i] as number, p[i + 1] as number, p[i + 2] as number, res)) as number;
      const b = cellIndex.get(cellOf(grid, p[i + 3] as number, p[i + 4] as number, p[i + 5] as number, res)) as number;
      const c = cellIndex.get(cellOf(grid, p[i + 6] as number, p[i + 7] as number, p[i + 8] as number, res)) as number;
      if (a === b || b === c || a === c) continue;
      const sorted = [a, b, c].sort((x, y) => x - y);
      const key = sorted.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      keep.push(t);
      ids.push(a, b, c);
    }
    after += keep.length;
    const positions = new Float32Array(keep.length * 9);
    const normals = new Float32Array(keep.length * 9);
    const uvs = soup.uvs ? new Float32Array(keep.length * 6) : null;
    const colors = soup.colors ? new Float32Array(keep.length * 9) : null;
    keep.forEach((t, k) => {
      for (let corner = 0; corner < 3; corner++) {
        const id = ids[k * 3 + corner] as number;
        const count = sums[id * 4 + 3] as number;
        positions[k * 9 + corner * 3] = (sums[id * 4] as number) / count;
        positions[k * 9 + corner * 3 + 1] = (sums[id * 4 + 1] as number) / count;
        positions[k * 9 + corner * 3 + 2] = (sums[id * 4 + 2] as number) / count;
      }
      normals.set(soup.normals.subarray(t * 9, t * 9 + 9), k * 9);
      if (uvs && soup.uvs) uvs.set(soup.uvs.subarray(t * 6, t * 6 + 6), k * 6);
      if (colors && soup.colors) colors.set(soup.colors.subarray(t * 9, t * 9 + 9), k * 9);
    });
    if (keep.length > 0) out.push({ material: soup.material, positions, normals, uvs, colors });
  }
  return { soups: out, before, after, resolution: res };
}
