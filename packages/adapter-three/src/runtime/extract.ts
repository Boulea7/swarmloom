import {
  type BufferAttribute,
  type BufferGeometry,
  Color,
  DoubleSide,
  type InterleavedBufferAttribute,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Points,
  Vector3,
} from "three";
import { ThreeAdapterError } from "../errors";
import type { FaceSoup, PointSet } from "../mesh/soup";
import { BRAND_PALETTE } from "../theme";

type Attribute = BufferAttribute | InterleavedBufferAttribute;

/** Normalized geometry plus the three.js materials it is drawn with. */
export interface ExtractedModel {
  /** One soup per material, in order of first use. Empty for point clouds. */
  soups: FaceSoup[];
  /** Only set when the model has no triangles. */
  cloud: PointSet | null;
  /** Material per soup index (`FaceSoup.material`). */
  materials: Material[];
  names: string[];
  /** Lowest Y of the normalized model (the floor). */
  floor: number;
  /** Source triangles before any decimation. */
  sourceTriangles: number;
  /** Content not built (for Blueprint.truncated). */
  dropped: { lines: number; points: number; invalid: number; cloud: number };
}

export interface ExtractOptions {
  /** Replace materials with brand palette materials (formats without real materials). */
  palette: boolean;
  maxSourceTriangles: number;
  maxCloudPoints: number;
}

interface MeshPart {
  mesh: Mesh;
  matrix: Matrix4;
  start: number;
  count: number;
  material: Material;
  key: string;
}

function materialOf(mesh: Mesh, index: number | undefined): Material | undefined {
  return Array.isArray(mesh.material) ? mesh.material[index ?? 0] : mesh.material;
}

/** Triangle ranges (in index/vertex units) of every visible mesh, with their world matrices. */
function collectParts(root: Object3D, palette: boolean): { parts: MeshPart[]; lines: number; points: Points[] } {
  const parts: MeshPart[] = [];
  const points: Points[] = [];
  let lines = 0;
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const any = object as Object3D & {
      isMesh?: boolean;
      isPoints?: boolean;
      isLine?: boolean;
      isInstancedMesh?: boolean;
    };
    if (any.isPoints) {
      points.push(object as Points);
      return;
    }
    if (any.isLine) {
      const g = (object as unknown as { geometry: BufferGeometry }).geometry;
      lines += g.index ? g.index.count / 2 : (g.getAttribute("position")?.count ?? 0) / 2;
      return;
    }
    if (!any.isMesh) return;
    const mesh = object as Mesh;
    const geometry = mesh.geometry;
    if (!geometry.getAttribute("position")) return;
    const total = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
    const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
    const matrices: Matrix4[] = [];
    if (any.isInstancedMesh) {
      const instanced = mesh as Mesh & { count: number; getMatrixAt(i: number, m: Matrix4): void };
      for (let i = 0; i < instanced.count; i++) {
        const m = new Matrix4();
        instanced.getMatrixAt(i, m);
        matrices.push(m.premultiply(mesh.matrixWorld));
      }
    } else matrices.push(mesh.matrixWorld.clone());
    for (const group of groups) {
      const material = materialOf(mesh, group.materialIndex);
      if (!material) continue;
      const start = Math.max(0, group.start);
      const count = Math.min(total - start, Number.isFinite(group.count) ? group.count : total);
      if (count < 3) continue;
      const key = palette ? `${material.uuid}:${group.materialIndex ?? 0}` : material.uuid;
      for (const matrix of matrices) parts.push({ mesh, matrix, start, count: count - (count % 3), material, key });
    }
  });
  return { parts, lines, points };
}

function paletteMaterial(index: number, name: string, vertexColors: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: vertexColors ? 0xffffff : new Color(BRAND_PALETTE[index % BRAND_PALETTE.length]),
    roughness: 0.55,
    metalness: 0.05,
    vertexColors,
    side: DoubleSide, // STL/OBJ/PLY winding is often inconsistent
  });
  material.name = name;
  return material;
}

function read3(attr: Attribute, i: number, out: Vector3): Vector3 {
  return out.set(attr.getX(i), attr.getY(i), attr.getZ(i));
}

/**
 * Flattens a parsed scene into per-material triangle soups (or a point cloud) in world space,
 * then normalizes to a unit bounding sphere around the bounds centre. Geometry is copied, so the
 * source scene can be discarded afterwards. Non-finite triangles are dropped and counted.
 */
export function extractModel(root: Object3D, options: ExtractOptions): ExtractedModel {
  const { parts, lines, points } = collectParts(root, options.palette);
  let sourceTriangles = 0;
  for (const part of parts) sourceTriangles += part.count / 3;
  if (sourceTriangles > options.maxSourceTriangles) {
    throw new ThreeAdapterError(
      "too-large",
      `This model has ${sourceTriangles} triangles, more than the ${options.maxSourceTriangles} that can be prepared in the browser.`,
    );
  }

  // Materials in order of first use; triangle count per material for exact allocation.
  const keyIndex = new Map<string, number>();
  const materials: Material[] = [];
  const names: string[] = [];
  const counts: number[] = [];
  const hasUv: boolean[] = [];
  const hasColor: boolean[] = [];
  for (const part of parts) {
    const geometry = part.mesh.geometry;
    const colors = geometry.getAttribute("color") !== undefined;
    let index = keyIndex.get(part.key);
    if (index === undefined) {
      index = materials.length;
      keyIndex.set(part.key, index);
      const name = part.material.name ?? "";
      materials.push(options.palette ? paletteMaterial(index, name, colors) : part.material);
      names.push(name);
      counts.push(0);
      hasUv.push(false);
      hasColor.push(false);
    }
    counts[index] = (counts[index] as number) + part.count / 3;
    if (geometry.getAttribute("uv")) hasUv[index] = true;
    const material = materials[index] as Material & { vertexColors?: boolean };
    if (colors && material.vertexColors) hasColor[index] = true;
  }

  const soups: FaceSoup[] = counts.map((n, i) => ({
    material: i,
    positions: new Float32Array(n * 9),
    normals: new Float32Array(n * 9),
    uvs: hasUv[i] ? new Float32Array(n * 6) : null,
    colors: hasColor[i] ? new Float32Array(n * 9) : null,
  }));
  const fill = counts.map(() => 0);
  let invalid = 0;
  const normalMatrix = new Matrix3();
  const v = [new Vector3(), new Vector3(), new Vector3()] as const;
  const n = [new Vector3(), new Vector3(), new Vector3()] as const;
  const e1 = new Vector3();
  const e2 = new Vector3();

  for (const part of parts) {
    const geometry = part.mesh.geometry;
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const position = geometry.getAttribute("position") as Attribute;
    const normal = geometry.getAttribute("normal") as Attribute;
    const uv = geometry.getAttribute("uv") as Attribute | undefined;
    const color = geometry.getAttribute("color") as Attribute | undefined;
    const index = geometry.index;
    const s = keyIndex.get(part.key) as number;
    const soup = soups[s] as FaceSoup;
    normalMatrix.getNormalMatrix(part.matrix);
    const mirrored = part.matrix.determinant() < 0;
    const ids = new Int32Array(3);
    for (let k = part.start; k < part.start + part.count; k += 3) {
      for (let c = 0; c < 3; c++) {
        const corner = mirrored ? k + 2 - c : k + c;
        ids[c] = index ? index.getX(corner) : corner;
      }
      let finite = true;
      for (let c = 0; c < 3; c++) {
        read3(position, ids[c] as number, v[c]).applyMatrix4(part.matrix);
        read3(normal, ids[c] as number, n[c]).applyMatrix3(normalMatrix);
        if (!Number.isFinite(v[c].x + v[c].y + v[c].z)) finite = false;
      }
      if (!finite) {
        invalid++;
        continue;
      }
      const t = fill[s] as number;
      for (let c = 0; c < 3; c++) {
        const pv = v[c];
        const nv = n[c];
        if (!(nv.lengthSq() > 1e-20) || !Number.isFinite(nv.x + nv.y + nv.z)) {
          nv.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0]));
        }
        nv.normalize();
        const o = t * 9 + c * 3;
        soup.positions[o] = pv.x;
        soup.positions[o + 1] = pv.y;
        soup.positions[o + 2] = pv.z;
        soup.normals[o] = nv.x;
        soup.normals[o + 1] = nv.y;
        soup.normals[o + 2] = nv.z;
        const id = ids[c] as number;
        if (soup.uvs && uv) {
          soup.uvs[t * 6 + c * 2] = uv.getX(id);
          soup.uvs[t * 6 + c * 2 + 1] = uv.getY(id);
        }
        if (soup.colors) {
          soup.colors[o] = color ? color.getX(id) : 1;
          soup.colors[o + 1] = color ? color.getY(id) : 1;
          soup.colors[o + 2] = color ? color.getZ(id) : 1;
        }
      }
      fill[s] = t + 1;
    }
  }
  // Drop the unused tail left by invalid triangles.
  const trimmed = soups
    .map((soup, i) => {
      const t = fill[i] as number;
      return {
        material: soup.material,
        positions: soup.positions.subarray(0, t * 9),
        normals: soup.normals.subarray(0, t * 9),
        uvs: soup.uvs ? soup.uvs.subarray(0, t * 6) : null,
        colors: soup.colors ? soup.colors.subarray(0, t * 9) : null,
      };
    })
    .filter((soup) => soup.positions.length > 0);

  let cloud: PointSet | null = null;
  let droppedPoints = 0;
  let droppedCloud = 0;
  if (trimmed.length === 0) {
    const result = extractCloud(points, options.maxCloudPoints);
    cloud = result.cloud;
    droppedCloud = result.dropped;
  } else {
    for (const p of points) droppedPoints += p.geometry.getAttribute("position")?.count ?? 0;
  }
  if (trimmed.length === 0 && (!cloud || cloud.positions.length === 0)) {
    throw new ThreeAdapterError("no-geometry", "This model contains no triangles or points to build.");
  }
  const floor = normalize(
    trimmed.map((s) => s.positions),
    cloud,
  );
  return {
    soups: trimmed,
    cloud,
    materials,
    names,
    floor,
    sourceTriangles,
    dropped: { lines, points: droppedPoints, invalid, cloud: droppedCloud },
  };
}

function extractCloud(sources: readonly Points[], max: number): { cloud: PointSet; dropped: number } {
  let total = 0;
  for (const p of sources) total += p.geometry.getAttribute("position")?.count ?? 0;
  const ratio = total > max ? max / total : 1;
  const positions: number[] = [];
  const colors: number[] = [];
  let anyColor = false;
  const v = new Vector3();
  let global = 0;
  for (const object of sources) {
    const geometry = object.geometry;
    const position = geometry.getAttribute("position") as Attribute | undefined;
    if (!position) continue;
    const color = geometry.getAttribute("color") as Attribute | undefined;
    if (color) anyColor = true;
    for (let i = 0; i < position.count; i++, global++) {
      if (ratio < 1 && Math.floor((global + 1) * ratio) === Math.floor(global * ratio)) continue;
      read3(position, i, v).applyMatrix4(object.matrixWorld);
      if (!Number.isFinite(v.x + v.y + v.z)) continue;
      positions.push(v.x, v.y, v.z);
      if (color) colors.push(color.getX(i), color.getY(i), color.getZ(i));
      else colors.push(1, 1, 1);
    }
  }
  const kept = positions.length / 3;
  return {
    cloud: { positions: Float32Array.from(positions), colors: anyColor ? Float32Array.from(colors) : null },
    dropped: total - kept,
  };
}

/** Centres on the bounds centre and scales to a unit bounding radius in place; returns the floor Y. */
function normalize(faces: readonly Float32Array[], cloud: PointSet | null): number {
  const all = cloud ? [...faces, cloud.positions] : [...faces];
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const p of all) {
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const value = p[i + a] as number;
        if (value < (min[a] as number)) min[a] = value;
        if (value > (max[a] as number)) max[a] = value;
      }
    }
  }
  const centre = [0, 1, 2].map((a) => ((min[a] as number) + (max[a] as number)) / 2);
  let radius = 0;
  for (const p of all) {
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(
        (p[i] as number) - (centre[0] as number),
        (p[i + 1] as number) - (centre[1] as number),
        (p[i + 2] as number) - (centre[2] as number),
      );
      if (d > radius) radius = d;
    }
  }
  // A single point or coincident geometry keeps scale 1 instead of dividing by zero.
  const scale = radius > 1e-12 ? 1 / radius : 1;
  for (const p of all) {
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a++) p[i + a] = ((p[i + a] as number) - (centre[a] as number)) * scale;
    }
  }
  return ((min[1] as number) - (centre[1] as number)) * scale;
}
