/** Model formats the adapter reads. */
export type ThreeFormat = "glb" | "gltf" | "obj" | "stl" | "ply";

/** Which source axis points up. glTF is always Y-up by specification. */
export type UpAxis = "y" | "z";

/** Formats without an axis convention, where the up axis is configurable. */
export type AxisFreeFormat = Exclude<ThreeFormat, "glb" | "gltf">;

/** Tuning knobs for {@link createThreeAdapter}. Every field is optional. */
export interface ThreeAdapterOptions {
  /** Stage height in CSS px. Default: the document viewport height, else 9:16 of the layout width. */
  height?: number;
  /** Largest accepted input in bytes. Default 64 MiB. */
  maxBytes?: number;
  /** Triangles kept for rendering; larger models are decimated (and `Blueprint.truncated` is set). Default 200 000. */
  maxTriangles?: number;
  /** Source triangles accepted before decimation; larger models are rejected outright. Default 4 000 000. */
  maxSourceTriangles?: number;
  /** Upper bound on build patches (each becomes up to three layers). Default 160, never above 400. */
  maxPatches?: number;
  /** Vertices dropped in as points while building (the final mesh is always complete). Default 60 000. */
  maxPoints?: number;
  /** Edges pulled while building. Default 40 000. */
  maxEdges?: number;
  /** Point-cloud points kept for rendering. Default 300 000. */
  maxCloudPoints?: number;
  /** Up axis per format for formats without a convention. Default: STL "z" (3D printing), others "y". */
  upAxis?: Partial<Record<AxisFreeFormat, UpAxis>>;
  /**
   * Base URL of the Draco decoder files (`draco_decoder.js` / `.wasm`, as shipped in
   * `three/examples/jsm/libs/draco/`). Only needed for `KHR_draco_mesh_compression` models;
   * without it those models are rejected with a clear message instead of fetching a CDN.
   */
  dracoDecoderPath?: string;
  /** Degrees the camera swings around the model (toward its front) once the build completes. 0 disables. Default 45. */
  orbitDegrees?: number;
}

/** Options with defaults applied and bounds enforced. */
export interface ResolvedOptions {
  height: number | undefined;
  maxBytes: number;
  maxTriangles: number;
  maxSourceTriangles: number;
  maxPatches: number;
  maxPoints: number;
  maxEdges: number;
  maxCloudPoints: number;
  upAxis: Record<AxisFreeFormat, UpAxis>;
  dracoDecoderPath: string | undefined;
  orbitDegrees: number;
}

/** Hard ceiling on patches regardless of options: keeps the planner and layer count bounded. */
export const PATCH_HARD_CAP = 400;

function bounded(name: string, value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`three adapter option "${name}" must be a finite number, got ${String(value)}`);
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function axis(name: string, value: UpAxis | undefined, fallback: UpAxis): UpAxis {
  if (value === undefined) return fallback;
  if (value !== "y" && value !== "z") throw new TypeError(`three adapter option "upAxis.${name}" must be "y" or "z"`);
  return value;
}

/** Applies defaults and clamps; throws TypeError on non-numeric or unknown values. */
export function resolveOptions(options: ThreeAdapterOptions = {}): ResolvedOptions {
  if (options.dracoDecoderPath !== undefined && typeof options.dracoDecoderPath !== "string") {
    throw new TypeError('three adapter option "dracoDecoderPath" must be a string');
  }
  return {
    height: options.height === undefined ? undefined : bounded("height", options.height, 0, 120, 8192),
    maxBytes: bounded("maxBytes", options.maxBytes, 64 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    maxTriangles: bounded("maxTriangles", options.maxTriangles, 200_000, 12, 2_000_000),
    maxSourceTriangles: bounded("maxSourceTriangles", options.maxSourceTriangles, 4_000_000, 12, 50_000_000),
    maxPatches: bounded("maxPatches", options.maxPatches, 160, 1, PATCH_HARD_CAP),
    maxPoints: bounded("maxPoints", options.maxPoints, 60_000, 0, 1_000_000),
    maxEdges: bounded("maxEdges", options.maxEdges, 40_000, 0, 500_000),
    maxCloudPoints: bounded("maxCloudPoints", options.maxCloudPoints, 300_000, 1, 4_000_000),
    upAxis: {
      obj: axis("obj", options.upAxis?.obj, "y"),
      stl: axis("stl", options.upAxis?.stl, "z"),
      ply: axis("ply", options.upAxis?.ply, "y"),
    },
    dracoDecoderPath: options.dracoDecoderPath,
    orbitDegrees: bounded("orbitDegrees", options.orbitDegrees, 45, 0, 360),
  };
}
