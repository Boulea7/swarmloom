import type { CustomLayer, Point, Rect } from "@swarmloom/core";
import type { SweepPoint } from "../mesh/sweep";
import type { BuildPlan } from "./types";

/** Custom layer task names registered by the three plugin. */
export const TASK = {
  points: "three:points",
  edges: "three:edges",
  patch: "three:patch",
  material: "three:material",
  light: "three:light",
} as const;

export type ThreeTask = (typeof TASK)[keyof typeof TASK];

/** Planner priority bases: lower builds earlier, so the phases overlap but run in order. */
const PRIORITY = { points: 1000, edges: 2000, patch: 3000, material: 4000, light: 5000 } as const;

/** JSON-safe layer payloads (CustomLayer.data). Stage px coordinates. */
export interface PointsData {
  patch: number;
  taps: Point[];
}
export interface EdgesData {
  patch: number;
  strokes: Array<[Point, Point]>;
}
export interface PatchData {
  patch: number;
  sweep: SweepPoint[];
  /** 0..1 share of the largest patch; drives the completion note. */
  weight: number;
}
export interface MaterialData {
  group: number;
  patches: number[];
  anchor: Point;
  name: string;
}
export interface LightData {
  from: Point;
  to: Point;
}

/** Layer ids are stable and readable: `three:<patch>:points`, `three:material:<n>`, `three:light`. */
export function layerId(kind: "points" | "edges" | "faces", patch: number): string {
  return `three:${patch}:${kind}`;
}

function custom(id: string, task: ThreeTask, box: Rect, priority: number, data: unknown, parent?: string): CustomLayer {
  const layer: CustomLayer = { id, kind: "custom", task, box, role: "mesh", priority, data };
  if (parent) layer.parent = parent;
  return layer;
}

/**
 * Emits the blueprint layers for a plan. Per patch the chain is points -> edges -> faces
 * (`parent` links, skipping empty phases); each material group follows the last patch it
 * covers and the light sweep follows the last material group.
 */
export function buildLayers(plan: BuildPlan): CustomLayer[] {
  const layers: CustomLayer[] = [];
  const lastOfPatch: string[] = [];
  for (const patch of plan.patches) {
    let previous: string | undefined;
    if (patch.vertices > 0) {
      const id = layerId("points", patch.index);
      const data: PointsData = { patch: patch.index, taps: patch.taps };
      layers.push(custom(id, TASK.points, patch.box, PRIORITY.points + patch.index, data, previous));
      previous = id;
    }
    if (patch.edges > 0 && patch.strokes.length > 0) {
      const id = layerId("edges", patch.index);
      const data: EdgesData = { patch: patch.index, strokes: patch.strokes };
      layers.push(custom(id, TASK.edges, patch.box, PRIORITY.edges + patch.index, data, previous));
      previous = id;
    }
    if (patch.triangles > 0) {
      const id = layerId("faces", patch.index);
      const data: PatchData = { patch: patch.index, sweep: patch.sweep, weight: patch.weight };
      layers.push(custom(id, TASK.patch, patch.box, PRIORITY.patch + patch.index, data, previous));
      previous = id;
    }
    lastOfPatch[patch.index] = previous ?? "";
  }
  let previousMaterial: string | undefined;
  plan.materials.forEach((group, g) => {
    const last = group.patches.length > 0 ? lastOfPatch[group.patches[group.patches.length - 1] as number] : "";
    const id = `three:material:${g}`;
    const data: MaterialData = { group: g, patches: group.patches, anchor: group.anchor, name: group.name };
    layers.push(custom(id, TASK.material, group.box, PRIORITY.material + g, data, last || undefined));
    previousMaterial = id;
  });
  const box = plan.modelBox;
  const light: LightData = {
    from: { x: box.x, y: box.y + box.h * 0.3 },
    to: { x: box.x + box.w, y: box.y + box.h * 0.55 },
  };
  layers.push(custom("three:light", TASK.light, box, PRIORITY.light, light, previousMaterial));
  return layers;
}
