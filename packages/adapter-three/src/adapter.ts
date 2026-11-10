import type { Adapter, AdapterContext, Blueprint, LoadedSource, SourceInput } from "@swarmloom/core";
import type { Material, Texture } from "three";
import { detectFormat, EXTENSIONS, MIME_TYPES, sniffFormat } from "./detect";
import { ThreeAdapterError, throwIfAborted } from "./errors";
import { decimateSoups } from "./mesh/decimate";
import { type ResolvedOptions, resolveOptions, type ThreeAdapterOptions } from "./options";
import { buildLayers } from "./plan/layers";
import { planCloud, planMesh } from "./plan/plan";
import type { BuildPlan } from "./plan/types";
import { createReprojector, fitCamera, stageProjector } from "./runtime/camera";
import { extractModel } from "./runtime/extract";
import { inputName, readInput, stageSize } from "./runtime/input";
import { parseModel } from "./runtime/load";
import { createThreePlugin, PLUGIN_NAME } from "./runtime/plugin";
import { ModelScene } from "./runtime/scene";
import { MODEL_ICON, stageTheme } from "./theme";

/** Material properties that may hold textures (three's standard/physical/basic families). */
const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "lightMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "transmissionMap",
  "thicknessMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "anisotropyMap",
] as const;

/** Releases materials, their textures and decoded ImageBitmaps (not collected automatically). */
function disposeMaterials(materials: readonly Material[]): void {
  const textures = new Set<Texture>();
  for (const material of materials) {
    const slots = material as unknown as Record<string, unknown>;
    for (const slot of TEXTURE_SLOTS) {
      const value = slots[slot] as Texture | null | undefined;
      if (value?.isTexture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) {
    const image = texture.image as { close?: () => void } | undefined;
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
    else image?.close?.();
  }
}

function titleOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Every point of the plan in model space, used for camera fitting and the reprojection depth grid. */
function samplePositions(soups: ReturnType<typeof extractModel>): Float32Array {
  if (soups.cloud) return soups.cloud.positions;
  let n = 0;
  for (const s of soups.soups) n += s.positions.length;
  const out = new Float32Array(n);
  let at = 0;
  for (const s of soups.soups) {
    out.set(s.positions, at);
    at += s.positions.length;
  }
  return out;
}

/**
 * Patch budget that keeps the build near 12-18 s: about four waves (one patch of points, edges
 * and faces each, ~4.4 s of cursor work) for the cursors the engine puts on a stage this size
 * (one per ~24 000 px², 3..64).
 */
function patchesForStage(size: { w: number; h: number }): number {
  const cursors = Math.min(64, Math.max(3, Math.round((size.w * size.h) / 24_000)));
  return Math.max(12, cursors * 4);
}

interface TruncationNote {
  parts: string[];
  dropped: number;
}

function note(target: TruncationNote, count: number, text: string): void {
  if (count <= 0) return;
  target.parts.push(text);
  target.dropped += count;
}

async function loadModel(input: SourceInput, ctx: AdapterContext, options: ResolvedOptions): Promise<LoadedSource> {
  const bytes = await readInput(input, ctx, options.maxBytes);
  const name = inputName(input);
  const format = detectFormat({ name, type: input.type, head: bytes.subarray(0, 1024) });
  if (!format) {
    throw new ThreeAdapterError(
      "unsupported-format",
      "This file is not a supported 3D model (GLB, glTF, OBJ, STL or PLY).",
    );
  }
  const parsed = await parseModel(format, bytes, options, ctx.signal);
  const extracted = extractModel(parsed.root, {
    palette: parsed.placeholderMaterials,
    maxSourceTriangles: options.maxSourceTriangles,
    maxCloudPoints: options.maxCloudPoints,
  });
  // The parsed scene is no longer needed: geometry was copied. Source materials are released
  // now when they were placeholders, otherwise together with the used ones on dispose().
  const sourceMaterials = new Set<Material>();
  parsed.root.traverse((object) => {
    (object as { geometry?: { dispose(): void } }).geometry?.dispose();
    const material = (object as { material?: Material | Material[] }).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) sourceMaterials.add(m);
  });
  if (parsed.placeholderMaterials) {
    for (const m of sourceMaterials) m.dispose();
    sourceMaterials.clear();
  }
  for (const m of extracted.materials) sourceMaterials.add(m);
  throwIfAborted(ctx.signal);

  const truncation: TruncationNote = { parts: [...parsed.notes], dropped: 0 };
  const decimated = decimateSoups(extracted.soups, options.maxTriangles);
  note(
    truncation,
    decimated.before - decimated.after,
    `simplified from ${decimated.before} to ${decimated.after} triangles`,
  );
  note(truncation, extracted.dropped.lines, `${extracted.dropped.lines} line segments not shown`);
  note(truncation, extracted.dropped.points, `${extracted.dropped.points} loose points not shown`);
  note(truncation, extracted.dropped.invalid, `${extracted.dropped.invalid} invalid triangles skipped`);
  note(truncation, extracted.dropped.cloud, `point cloud thinned by ${extracted.dropped.cloud} points`);

  const theme = stageTheme(ctx.theme === "dark" ? "dark" : "light");
  const size = stageSize(ctx, options.height);
  const samples = samplePositions({ ...extracted, soups: decimated.soups });
  const { camera, pose } = fitCamera(size, samples);
  const projector = stageProjector(camera, size);
  const limits = {
    maxPatches: Math.min(options.maxPatches, patchesForStage(size)),
    maxPoints: options.maxPoints,
    maxEdges: options.maxEdges,
    maxLayers: ctx.maxLayers,
  };
  const plan: BuildPlan = extracted.cloud
    ? planCloud(extracted.cloud, size, projector, limits)
    : planMesh(decimated.soups, extracted.names, size, projector, limits);
  throwIfAborted(ctx.signal);

  const groupOf = extracted.materials.map(() => 0);
  plan.materials.forEach((group, g) => {
    for (const m of group.materials) groupOf[m] = g;
  });
  const title = titleOf(name);
  const scene = new ModelScene(
    {
      plan,
      materials: extracted.materials,
      groupOf,
      floor: extracted.floor,
      label: title ? `3D model ${title}` : "3D model",
    },
    { size, pose, theme, orbitDegrees: options.orbitDegrees },
  );
  let disposed = false;
  const plugin = createThreePlugin(scene, createReprojector(camera, size, samples), () => disposed);

  const blueprint: Blueprint = {
    version: 1,
    source: {
      type: "three",
      ...(name ? { name } : {}),
      ...(title ? { title } : {}),
      ...(input.url ? { url: input.url } : {}),
    },
    size,
    viewport: size,
    background: theme.background,
    scheme: theme.scheme,
    icon: MODEL_ICON,
    layers: buildLayers(plan),
    plugins: [PLUGIN_NAME],
  };
  if (truncation.parts.length > 0) {
    const reason = truncation.parts.join("; ");
    blueprint.truncated = { reason: reason.charAt(0).toUpperCase() + reason.slice(1), dropped: truncation.dropped };
  }
  return {
    blueprint,
    plugins: [plugin],
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.unmount();
      disposeMaterials([...sourceMaterials]);
    },
  };
}

/**
 * Creates the 3D model adapter (GLB, glTF with embedded data, OBJ, STL, PLY).
 *
 * `load()` parses the model offline (decoders are imported only when a file needs them),
 * normalizes and, past the triangle budget, simplifies it, then plans a build of spatial
 * patches: vertices tapped in as points, feature edges pulled, faces swept in, materials
 * faded in and a light sweep. The returned plugin renders it all on one WebGL canvas.
 *
 * @throws ThreeAdapterError from `load()` for empty, oversized, malformed or unsupported input.
 */
export function createThreeAdapter(options: ThreeAdapterOptions = {}): Adapter {
  const resolved = resolveOptions(options);
  return {
    id: "three",
    label: "3D model",
    extensions: [...EXTENSIONS],
    mime: Object.keys(MIME_TYPES),
    sniff(head: Uint8Array, name?: string): boolean {
      const sniffed = sniffFormat(head);
      if (sniffed) return true;
      // Binary STL has no signature: accept it by name only.
      return name !== undefined && /\.stl$/i.test(name.split(/[?#]/, 1)[0] ?? "") && head.length >= 84;
    },
    load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      return loadModel(input, ctx, resolved);
    },
  };
}

/** Default adapter instance. */
export const threeAdapter: Adapter = createThreeAdapter();
