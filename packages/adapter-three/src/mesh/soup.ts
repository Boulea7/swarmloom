/**
 * Format-neutral geometry the planner works on. Positions are normalized model space
 * (centred, bounding radius about 1) and Y-up. No three.js types here so the planning code
 * stays testable without WebGL.
 */

/** Triangle soup of one material: every triangle owns its three corners. */
export interface FaceSoup {
  /** Index into the model's material list. */
  material: number;
  /** 9 floats per triangle. */
  positions: Float32Array;
  /** 9 floats per triangle. */
  normals: Float32Array;
  /** 6 floats per triangle, or null. */
  uvs: Float32Array | null;
  /** 9 floats per triangle (linear RGB), or null. */
  colors: Float32Array | null;
}

/** Points of a point cloud (no faces). */
export interface PointSet {
  /** 3 floats per point. */
  positions: Float32Array;
  /** 3 floats per point (linear RGB), or null. */
  colors: Float32Array | null;
}

/** Number of triangles in a soup. */
export function triangleCount(soup: FaceSoup): number {
  return soup.positions.length / 9;
}

/** Per-triangle centroids, unit normals and areas of soups concatenated in order. */
export interface FaceFrame {
  count: number;
  centroids: Float32Array;
  normals: Float32Array;
  areas: Float32Array;
}

/** Computes centroid, geometric unit normal (zero for degenerate triangles) and area per triangle. */
export function faceFrame(soups: readonly FaceSoup[]): FaceFrame {
  let count = 0;
  for (const soup of soups) count += triangleCount(soup);
  const centroids = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const areas = new Float32Array(count);
  let t = 0;
  for (const soup of soups) {
    const p = soup.positions;
    for (let i = 0; i < p.length; i += 9, t++) {
      const ax = p[i] as number;
      const ay = p[i + 1] as number;
      const az = p[i + 2] as number;
      const bx = p[i + 3] as number;
      const by = p[i + 4] as number;
      const bz = p[i + 5] as number;
      const cx = p[i + 6] as number;
      const cy = p[i + 7] as number;
      const cz = p[i + 8] as number;
      centroids[t * 3] = (ax + bx + cx) / 3;
      centroids[t * 3 + 1] = (ay + by + cy) / 3;
      centroids[t * 3 + 2] = (az + bz + cz) / 3;
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      areas[t] = len / 2;
      if (len > 1e-12) {
        normals[t * 3] = nx / len;
        normals[t * 3 + 1] = ny / len;
        normals[t * 3 + 2] = nz / len;
      }
    }
  }
  return { count, centroids, normals, areas };
}
