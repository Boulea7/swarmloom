import type { Point, Rect } from "@swarmloom/core";
import type { FaceSoup } from "../mesh/soup";
import type { SweepPoint } from "../mesh/sweep";

/** Maps a model-space point to stage px. Returns false when the point is behind the camera. */
export type Projector = (x: number, y: number, z: number, out: Point) => boolean;

/** Choreography and statistics of one spatial patch (one cursor's piece of work per phase). */
export interface PatchPlan {
  index: number;
  triangles: number;
  /** Vertices dropped in as points by this patch (after point budget sampling). */
  vertices: number;
  edges: number;
  /** Screen bounds of the patch in stage px. */
  box: Rect;
  /** Share of the largest patch's surface area (or point count), 0..1; drives the note pitch. */
  weight: number;
  /** Points phase: one tap per chunk of vertices, in reveal order. */
  taps: Point[];
  /** Edges phase: one representative edge pulled per chunk of edges. */
  strokes: Array<[Point, Point]>;
  /** Faces phase: zig-zag waypoints with the reveal fraction reached at each. */
  sweep: SweepPoint[];
}

/** One material's triangles re-ordered by (patch, reveal order), ready for upload. */
export interface FaceBuffers {
  soup: FaceSoup;
  /** Patch index per corner. */
  patch: Float32Array;
  /** Reveal order (0..1] within the patch, per corner. */
  order: Float32Array;
  /** Triangle centroid repeated per corner (9 floats per triangle); faces grow out of it. */
  centroid: Float32Array;
  /** Contiguous triangle ranges per patch inside this soup. */
  ranges: Array<{ patch: number; start: number; count: number }>;
}

/** Build-phase points: welded mesh vertices or cloud points. */
export interface PointBuffers {
  count: number;
  positions: Float32Array;
  colors: Float32Array | null;
  patch: Float32Array;
  order: Float32Array;
}

/** Build-phase edges, oriented so each grows in the sweep direction. */
export interface EdgeBuffers {
  count: number;
  start: Float32Array;
  end: Float32Array;
  patch: Float32Array;
  order: Float32Array;
}

/** A group of materials faded in together by one cursor. */
export interface MaterialPlan {
  /** Material indices in the group. */
  materials: number[];
  /** Patches whose faces use these materials (the group waits for them). */
  patches: number[];
  anchor: Point;
  box: Rect;
  /** Display name of the first material (shown in the cursor bubble), may be empty. */
  name: string;
}

/** Everything the runtime needs to build layers and GPU buffers. */
export interface BuildPlan {
  kind: "mesh" | "cloud";
  patches: PatchPlan[];
  faces: FaceBuffers[];
  points: PointBuffers;
  edges: EdgeBuffers;
  materials: MaterialPlan[];
  /** Screen bounds of the whole model. */
  modelBox: Rect;
}

/** Budgets for {@link planMesh} / {@link planCloud}. */
export interface PlanLimits {
  maxPatches: number;
  maxPoints: number;
  maxEdges: number;
  /** Upper bound on emitted layers (AdapterContext.maxLayers). */
  maxLayers?: number;
}
