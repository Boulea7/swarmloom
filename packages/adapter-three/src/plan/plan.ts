import type { Point, Rect, Size } from "@swarmloom/core";
import { clusterItems, targetPatchCount } from "../mesh/cluster";
import { buildEdges, pickEdges } from "../mesh/edges";
import { type FaceSoup, faceFrame, type PointSet, triangleCount } from "../mesh/soup";
import { type Box2, sweepParam, sweepPath, sweepRows } from "../mesh/sweep";
import { weldCorners } from "../mesh/weld";
import type {
  BuildPlan,
  EdgeBuffers,
  FaceBuffers,
  MaterialPlan,
  PatchPlan,
  PlanLimits,
  PointBuffers,
  Projector,
} from "./types";

/** Edges flatter than this (coplanar quad diagonals) are never drawn. */
const MIN_EDGE_ANGLE = (1 * Math.PI) / 180;
/** At most this many material layers; extra materials share a layer. */
export const MAX_MATERIAL_LAYERS = 8;
/** Weld tolerance in normalized model units (model radius ~1). */
const WELD_TOLERANCE = 1e-4;
/** Triangles per patch for typical models (one patch is about 4 s of cursor work). */
const TRIANGLES_PER_PATCH = 150;
/** Small models still split into this many patches, so most of the swarm gets a patch to build. */
const MIN_MESH_PATCHES = 16;

/* ------------------------------------------------------------------ */
/* Small geometry helpers                                              */
/* ------------------------------------------------------------------ */

function emptyBox(): Box2 {
  return { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: -Infinity, y1: -Infinity };
}

function grow(box: Box2, x: number, y: number): void {
  if (x < box.x0) box.x0 = x;
  if (y < box.y0) box.y0 = y;
  if (x > box.x1) box.x1 = x;
  if (y > box.y1) box.y1 = y;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function clampPoint(x: number, y: number, size: Size): Point {
  return { x: round1(Math.min(Math.max(x, 0), size.w)), y: round1(Math.min(Math.max(y, 0), size.h)) };
}

function toRect(box: Box2, size: Size): Rect {
  if (!(box.x1 >= box.x0 && box.y1 >= box.y0)) return { x: size.w / 2, y: size.h / 2, w: 1, h: 1 };
  const x0 = Math.min(Math.max(box.x0, 0), size.w);
  const y0 = Math.min(Math.max(box.y0, 0), size.h);
  const x1 = Math.min(Math.max(box.x1, 0), size.w);
  const y1 = Math.min(Math.max(box.y1, 0), size.h);
  return { x: round1(x0), y: round1(y0), w: Math.max(1, round1(x1 - x0)), h: Math.max(1, round1(y1 - y0)) };
}

/** The box the cursor sweeps: the patch bounds pulled in a little so the path stays on the patch. */
function sweepBoxOf(box: Box2): Box2 {
  if (!(box.x1 >= box.x0 && box.y1 >= box.y0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const ix = Math.min(6, (box.x1 - box.x0) * 0.15);
  const iy = Math.min(6, (box.y1 - box.y0) * 0.15);
  return { x0: box.x0 + ix, y0: box.y0 + iy, x1: box.x1 - ix, y1: box.y1 - iy };
}

/** Projects n points (3 floats each) to stage px; points behind the camera fall back to `fallback`. */
function projectAll(positions: Float32Array, project: Projector, fallback: Point): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n * 2);
  const p = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const ok = project(positions[i * 3] as number, positions[i * 3 + 1] as number, positions[i * 3 + 2] as number, p);
    out[i * 2] = ok && Number.isFinite(p.x) ? p.x : fallback.x;
    out[i * 2 + 1] = ok && Number.isFinite(p.y) ? p.y : fallback.y;
  }
  return out;
}

/**
 * Groups items by label and sorts each group by key (ties by item index). Returns the sorted
 * items with group offsets, plus each item's reveal order (rank + 1) / groupSize.
 */
function bucketByKey(
  labels: ArrayLike<number>,
  groups: number,
  keys: Float64Array,
): { start: Uint32Array; items: Uint32Array; order: Float32Array } {
  const n = labels.length;
  const start = new Uint32Array(groups + 1);
  for (let i = 0; i < n; i++) start[(labels[i] as number) + 1] = (start[(labels[i] as number) + 1] as number) + 1;
  for (let g = 0; g < groups; g++) start[g + 1] = (start[g + 1] as number) + (start[g] as number);
  const fill = start.slice(0, groups);
  const items = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const g = labels[i] as number;
    items[fill[g] as number] = i;
    fill[g] = (fill[g] as number) + 1;
  }
  const order = new Float32Array(n);
  for (let g = 0; g < groups; g++) {
    const s = start[g] as number;
    const e = start[g + 1] as number;
    const bucket = Array.from(items.subarray(s, e));
    bucket.sort((a, b) => (keys[a] as number) - (keys[b] as number) || a - b);
    const size = e - s;
    bucket.forEach((item, r) => {
      items[s + r] = item;
      order[item] = (r + 1) / size;
    });
  }
  return { start, items, order };
}

/** Patch cap that keeps the total layer count within `maxLayers` (three phases per patch). */
function patchCap(limits: PlanLimits, materialLayers: number, phases: number): number {
  if (limits.maxLayers === undefined) return limits.maxPatches;
  const room = Math.floor((limits.maxLayers - materialLayers - 1) / phases);
  return Math.max(1, Math.min(limits.maxPatches, room));
}

/**
 * Relabels clusters so patch 0 is nearest the model's screen centre and indices grow outward;
 * the build then spreads from the middle of the model. Returns old label -> new index.
 */
function rankClusters(labels: Uint32Array, count: number, screen: Float32Array, centre: Point): Uint32Array {
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const n = new Float64Array(count);
  for (let i = 0; i < labels.length; i++) {
    const c = labels[i] as number;
    sx[c] = (sx[c] as number) + (screen[i * 2] as number);
    sy[c] = (sy[c] as number) + (screen[i * 2 + 1] as number);
    n[c] = (n[c] as number) + 1;
  }
  const dist = (c: number): number =>
    Math.hypot((sx[c] as number) / (n[c] as number) - centre.x, (sy[c] as number) / (n[c] as number) - centre.y);
  const idx = Array.from({ length: count }, (_, i) => i).sort((a, b) => dist(a) - dist(b) || a - b);
  const rank = new Uint32Array(count);
  idx.forEach((old, r) => {
    rank[old] = r;
  });
  return rank;
}

function tapsFor(
  items: Uint32Array,
  s: number,
  e: number,
  screen: Float32Array,
  size: Size,
  perTap: number,
  max: number,
) {
  const n = e - s;
  const taps: Point[] = [];
  if (n === 0) return taps;
  const k = Math.max(1, Math.min(max, Math.ceil(n / perTap)));
  for (let j = 0; j < k; j++) {
    const item = items[s + Math.floor(((j + 0.5) * n) / k)] as number;
    taps.push(clampPoint(screen[item * 2] as number, screen[item * 2 + 1] as number, size));
  }
  return taps;
}

/* ------------------------------------------------------------------ */
/* Mesh planning                                                        */
/* ------------------------------------------------------------------ */

/**
 * Plans the build of a triangle mesh: welds corners, picks feature edges, clusters triangles
 * into spatial patches and orders every vertex, edge and triangle along its patch's sweep.
 *
 * @param soups Normalized geometry, already within the triangle budget.
 * @param materialNames Display names per material index.
 * @param size Stage size in px.
 * @param project Build-camera projection to stage px.
 */
export function planMesh(
  soups: readonly FaceSoup[],
  materialNames: readonly string[],
  size: Size,
  project: Projector,
  limits: PlanLimits,
): BuildPlan {
  const frame = faceFrame(soups);
  const triangles = frame.count;
  const centre = { x: size.w / 2, y: size.h / 2 };
  project(0, 0, 0, centre);

  // Topology: welded vertices and the edges worth pulling.
  const weld = weldCorners(
    soups.map((s) => s.positions),
    WELD_TOLERANCE,
  );
  const allEdges = buildEdges(weld.corner, frame.normals);
  const picked = pickEdges(allEdges, limits.maxEdges, MIN_EDGE_ANGLE);

  // Spatial patches.
  const materialIds = [...new Set(soups.map((s) => s.material))].sort((a, b) => a - b);
  const materialLayers = Math.min(MAX_MATERIAL_LAYERS, Math.max(1, materialIds.length));
  const k = targetPatchCount(triangles, patchCap(limits, materialLayers, 3), TRIANGLES_PER_PATCH, MIN_MESH_PATCHES);
  const clusters = clusterItems({ positions: frame.centroids, normals: frame.normals }, { k });
  const patchCount = clusters.count;

  const vScreen = projectAll(weld.positions, project, centre);
  const cScreen = projectAll(frame.centroids, project, centre);
  const rank = rankClusters(clusters.labels, patchCount, cScreen, centre);
  const labels = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) labels[t] = rank[clusters.labels[t] as number] as number;

  // Patch screen bounds and sweep geometry.
  const boxes = Array.from({ length: patchCount }, emptyBox);
  const modelBox = emptyBox();
  const area = new Float64Array(patchCount);
  for (let t = 0; t < triangles; t++) {
    const box = boxes[labels[t] as number] as Box2;
    for (let c = 0; c < 3; c++) {
      const v = weld.corner[t * 3 + c] as number;
      grow(box, vScreen[v * 2] as number, vScreen[v * 2 + 1] as number);
      grow(modelBox, vScreen[v * 2] as number, vScreen[v * 2 + 1] as number);
    }
    area[labels[t] as number] = (area[labels[t] as number] as number) + (frame.areas[t] as number);
  }
  const sweepBoxes = boxes.map(sweepBoxOf);
  const rows = sweepBoxes.map((b) => sweepRows(b));
  const paramOf = (patch: number, x: number, y: number): number =>
    sweepParam(x, y, sweepBoxes[patch] as Box2, rows[patch] as number);

  // Triangle reveal order along each sweep.
  const triKeys = new Float64Array(triangles);
  for (let t = 0; t < triangles; t++) {
    triKeys[t] = paramOf(labels[t] as number, cScreen[t * 2] as number, cScreen[t * 2 + 1] as number);
  }
  const triBuckets = bucketByKey(labels, patchCount, triKeys);

  // Vertices: owned by the patch of their first triangle, sampled down to the point budget.
  const owner = new Int32Array(weld.count).fill(-1);
  for (let t = 0; t < triangles; t++) {
    for (let c = 0; c < 3; c++) {
      const v = weld.corner[t * 3 + c] as number;
      if ((owner[v] as number) < 0) owner[v] = labels[t] as number;
    }
  }
  const ratio = weld.count > limits.maxPoints ? limits.maxPoints / weld.count : 1;
  const keptVertices: number[] = [];
  for (let v = 0; v < weld.count; v++) {
    if ((owner[v] as number) < 0) continue;
    if (ratio < 1 && Math.floor((v + 1) * ratio) === Math.floor(v * ratio)) continue;
    keptVertices.push(v);
  }
  const vLabels = Uint32Array.from(keptVertices, (v) => owner[v] as number);
  const vKeys = Float64Array.from(keptVertices, (v) =>
    paramOf(owner[v] as number, vScreen[v * 2] as number, vScreen[v * 2 + 1] as number),
  );
  const vBuckets = bucketByKey(vLabels, patchCount, vKeys);
  const keptScreen = new Float32Array(keptVertices.length * 2);
  const points: PointBuffers = {
    count: keptVertices.length,
    positions: new Float32Array(keptVertices.length * 3),
    colors: null,
    patch: Float32Array.from(vLabels),
    order: vBuckets.order,
  };
  keptVertices.forEach((v, i) => {
    points.positions.set(weld.positions.subarray(v * 3, v * 3 + 3), i * 3);
    keptScreen[i * 2] = vScreen[v * 2] as number;
    keptScreen[i * 2 + 1] = vScreen[v * 2 + 1] as number;
  });

  // Edges: owned by the patch of their first face, oriented along the sweep.
  const edgeCount = picked.length;
  const eLabels = new Uint32Array(edgeCount);
  const eKeys = new Float64Array(edgeCount);
  const eFrom = new Uint32Array(edgeCount);
  const eTo = new Uint32Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    const e = picked[i] as number;
    const patch = labels[allEdges.face[e] as number] as number;
    let a = allEdges.a[e] as number;
    let b = allEdges.b[e] as number;
    let pa = paramOf(patch, vScreen[a * 2] as number, vScreen[a * 2 + 1] as number);
    let pb = paramOf(patch, vScreen[b * 2] as number, vScreen[b * 2 + 1] as number);
    if (pb < pa) {
      [a, b] = [b, a];
      [pa, pb] = [pb, pa];
    }
    eLabels[i] = patch;
    eKeys[i] = (pa + pb) / 2;
    eFrom[i] = a;
    eTo[i] = b;
  }
  const eBuckets = bucketByKey(eLabels, patchCount, eKeys);
  const edges: EdgeBuffers = {
    count: edgeCount,
    start: new Float32Array(edgeCount * 3),
    end: new Float32Array(edgeCount * 3),
    patch: Float32Array.from(eLabels),
    order: eBuckets.order,
  };
  for (let i = 0; i < edgeCount; i++) {
    const a = eFrom[i] as number;
    const b = eTo[i] as number;
    edges.start.set(weld.positions.subarray(a * 3, a * 3 + 3), i * 3);
    edges.end.set(weld.positions.subarray(b * 3, b * 3 + 3), i * 3);
  }

  // Per-patch choreography.
  const maxArea = Math.max(...area, 1e-12);
  const patches: PatchPlan[] = [];
  for (let p = 0; p < patchCount; p++) {
    const vs = vBuckets.start[p] as number;
    const ve = vBuckets.start[p + 1] as number;
    const es = eBuckets.start[p] as number;
    const ee = eBuckets.start[p + 1] as number;
    const strokes: Array<[Point, Point]> = [];
    const ne = ee - es;
    if (ne > 0) {
      const chunks = Math.max(1, Math.min(2, Math.ceil(ne / 20)));
      for (let j = 0; j < chunks; j++) {
        let best = -1;
        let bestLen = -1;
        for (let r = es + Math.floor((j * ne) / chunks); r < es + Math.floor(((j + 1) * ne) / chunks); r++) {
          const i = eBuckets.items[r] as number;
          const a = eFrom[i] as number;
          const b = eTo[i] as number;
          const len = Math.hypot(
            (vScreen[b * 2] as number) - (vScreen[a * 2] as number),
            (vScreen[b * 2 + 1] as number) - (vScreen[a * 2 + 1] as number),
          );
          if (len > bestLen) {
            bestLen = len;
            best = i;
          }
        }
        if (best < 0) continue;
        const a = eFrom[best] as number;
        const b = eTo[best] as number;
        strokes.push([
          clampPoint(vScreen[a * 2] as number, vScreen[a * 2 + 1] as number, size),
          clampPoint(vScreen[b * 2] as number, vScreen[b * 2 + 1] as number, size),
        ]);
      }
    }
    const sb = sweepBoxes[p] as Box2;
    patches.push({
      index: p,
      triangles: (triBuckets.start[p + 1] as number) - (triBuckets.start[p] as number),
      vertices: ve - vs,
      edges: ne,
      box: toRect(boxes[p] as Box2, size),
      weight: (area[p] as number) / maxArea,
      taps: tapsFor(vBuckets.items, vs, ve, keptScreen, size, 12, 3),
      strokes,
      sweep: sweepPath(sb, rows[p] as number).map((w) => ({ ...clampPoint(w.x, w.y, size), p: w.p })),
    });
  }

  // Face buffers per material soup, triangles grouped by patch then reveal order.
  const faces: FaceBuffers[] = [];
  let base = 0;
  for (const soup of soups) {
    const n = triangleCount(soup);
    const local = Array.from({ length: n }, (_, i) => base + i);
    local.sort(
      (a, b) =>
        (labels[a] as number) - (labels[b] as number) ||
        (triBuckets.order[a] as number) - (triBuckets.order[b] as number) ||
        a - b,
    );
    faces.push(reorderSoup(soup, local, base, labels, triBuckets.order, frame.centroids));
    base += n;
  }

  // Material groups: consecutive materials share a layer when there are many.
  const groups = Math.min(MAX_MATERIAL_LAYERS, materialIds.length);
  const materials: MaterialPlan[] = [];
  for (let g = 0; g < groups; g++) {
    const ids = materialIds.slice(
      Math.floor((g * materialIds.length) / groups),
      Math.floor(((g + 1) * materialIds.length) / groups),
    );
    const box = emptyBox();
    const touched = new Set<number>();
    let sx = 0;
    let sy = 0;
    let count = 0;
    let offset = 0;
    soups.forEach((soup, s) => {
      const n = triangleCount(soup);
      if (ids.includes(soup.material)) {
        for (const range of (faces[s] as FaceBuffers).ranges) touched.add(range.patch);
        for (let t = offset; t < offset + n; t++) {
          const x = cScreen[t * 2] as number;
          const y = cScreen[t * 2 + 1] as number;
          grow(box, x, y);
          sx += x;
          sy += y;
          count++;
        }
      }
      offset += n;
    });
    const name = (materialNames[ids[0] as number] ?? "").trim();
    materials.push({
      materials: ids,
      patches: [...touched].sort((a, b) => a - b),
      anchor: count > 0 ? clampPoint(sx / count, sy / count, size) : clampPoint(centre.x, centre.y, size),
      box: toRect(box, size),
      name: name.length <= 24 ? name : `${name.slice(0, 23)}…`,
    });
  }

  return { kind: "mesh", patches, faces, points, edges, materials, modelBox: toRect(modelBox, size) };
}

function reorderSoup(
  soup: FaceSoup,
  sorted: readonly number[],
  base: number,
  labels: Uint32Array,
  order: Float32Array,
  centroids: Float32Array,
): FaceBuffers {
  const n = sorted.length;
  const out: FaceSoup = {
    material: soup.material,
    positions: new Float32Array(n * 9),
    normals: new Float32Array(n * 9),
    uvs: soup.uvs ? new Float32Array(n * 6) : null,
    colors: soup.colors ? new Float32Array(n * 9) : null,
  };
  const patch = new Float32Array(n * 3);
  const ord = new Float32Array(n * 3);
  const centroid = new Float32Array(n * 9);
  const ranges: FaceBuffers["ranges"] = [];
  sorted.forEach((t, i) => {
    const local = t - base;
    out.positions.set(soup.positions.subarray(local * 9, local * 9 + 9), i * 9);
    out.normals.set(soup.normals.subarray(local * 9, local * 9 + 9), i * 9);
    if (out.uvs && soup.uvs) out.uvs.set(soup.uvs.subarray(local * 6, local * 6 + 6), i * 6);
    if (out.colors && soup.colors) out.colors.set(soup.colors.subarray(local * 9, local * 9 + 9), i * 9);
    const label = labels[t] as number;
    for (let c = 0; c < 3; c++) {
      patch[i * 3 + c] = label;
      ord[i * 3 + c] = order[t] as number;
      centroid.set(centroids.subarray(t * 3, t * 3 + 3), i * 9 + c * 3);
    }
    const last = ranges[ranges.length - 1];
    if (last && last.patch === label) last.count++;
    else ranges.push({ patch: label, start: i, count: 1 });
  });
  return { soup: out, patch, order: ord, centroid, ranges };
}

/* ------------------------------------------------------------------ */
/* Point-cloud planning                                                */
/* ------------------------------------------------------------------ */

/** Plans a point cloud: spatial clusters of points dropped in along each cluster's sweep. */
export function planCloud(cloud: PointSet, size: Size, project: Projector, limits: PlanLimits): BuildPlan {
  const n = cloud.positions.length / 3;
  const centre = { x: size.w / 2, y: size.h / 2 };
  project(0, 0, 0, centre);
  const k = targetPatchCount(n, patchCap(limits, 1, 1), 900);
  const clusters = clusterItems({ positions: cloud.positions }, { k });
  const patchCount = clusters.count;
  const screen = projectAll(cloud.positions, project, centre);
  const rank = rankClusters(clusters.labels, patchCount, screen, centre);
  const labels = Uint32Array.from(clusters.labels, (c) => rank[c] as number);

  const boxes = Array.from({ length: patchCount }, emptyBox);
  const modelBox = emptyBox();
  for (let i = 0; i < n; i++) {
    grow(boxes[labels[i] as number] as Box2, screen[i * 2] as number, screen[i * 2 + 1] as number);
    grow(modelBox, screen[i * 2] as number, screen[i * 2 + 1] as number);
  }
  const sweepBoxes = boxes.map(sweepBoxOf);
  const rows = sweepBoxes.map((b) => sweepRows(b));
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = labels[i] as number;
    keys[i] = sweepParam(
      screen[i * 2] as number,
      screen[i * 2 + 1] as number,
      sweepBoxes[p] as Box2,
      rows[p] as number,
    );
  }
  const buckets = bucketByKey(labels, patchCount, keys);
  const maxSize = Math.max(...clusters.sizes, 1);
  const patches: PatchPlan[] = [];
  for (let p = 0; p < patchCount; p++) {
    const s = buckets.start[p] as number;
    const e = buckets.start[p + 1] as number;
    patches.push({
      index: p,
      triangles: 0,
      vertices: e - s,
      edges: 0,
      box: toRect(boxes[p] as Box2, size),
      weight: (e - s) / maxSize,
      taps: tapsFor(buckets.items, s, e, screen, size, 200, 5),
      strokes: [],
      sweep: [],
    });
  }
  const modelRect = toRect(modelBox, size);
  return {
    kind: "cloud",
    patches,
    faces: [],
    points: {
      count: n,
      positions: cloud.positions,
      colors: cloud.colors,
      patch: Float32Array.from(labels),
      order: buckets.order,
    },
    edges: {
      count: 0,
      start: new Float32Array(0),
      end: new Float32Array(0),
      patch: new Float32Array(0),
      order: new Float32Array(0),
    },
    materials: [
      {
        materials: [],
        patches: patches.map((p) => p.index),
        anchor: clampPoint(centre.x, centre.y, size),
        box: modelRect,
        name: "",
      },
    ],
    modelBox: modelRect,
  };
}
