import { type BufferGeometry, Group, type Material, Mesh, MeshStandardMaterial, type Object3D, Points } from "three";
import { decodeText, inspectGltf, inspectPly, inspectStl, readGlbJson } from "../detect";
import { ThreeAdapterError, throwIfAborted } from "../errors";
import type { ResolvedOptions, ThreeFormat } from "../options";

/** A parsed source scene, before extraction. */
export interface ParsedModel {
  root: Object3D;
  /** True when materials are placeholders (formats without materials) to be replaced by the palette. */
  placeholderMaterials: boolean;
  /** Notes on content that will not be shown, for Blueprint.truncated. */
  notes: string[];
}

function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function rejectPreflight(external: string[], unsupported: string[]): void {
  if (external.length > 0) {
    const list = external.slice(0, 3).join(", ") + (external.length > 3 ? ", ..." : "");
    throw new ThreeAdapterError(
      "external-resource",
      `This glTF file references external files (${list}). Export it as a single GLB or a glTF with embedded data so nothing has to be fetched.`,
    );
  }
  if (unsupported.length > 0) {
    throw new ThreeAdapterError(
      "unsupported-extension",
      `This glTF file requires extensions that are not supported: ${unsupported.join(", ")}.`,
    );
  }
}

async function parseGltf(
  data: ArrayBuffer | Record<string, unknown>,
  json: unknown,
  options: ResolvedOptions,
  signal: AbortSignal | undefined,
): Promise<ParsedModel> {
  const preflight = inspectGltf(json, options.maxBytes * 8);
  rejectPreflight(preflight.external, preflight.unsupported);
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  let disposeDraco: (() => void) | null = null;
  if (preflight.needsDraco) {
    if (!options.dracoDecoderPath) {
      throw new ThreeAdapterError(
        "needs-decoder",
        "This model uses Draco mesh compression. Configure dracoDecoderPath for the 3D adapter, or re-export the model without Draco.",
      );
    }
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    const draco = new DRACOLoader();
    draco.setDecoderPath(options.dracoDecoderPath);
    loader.setDRACOLoader(draco);
    disposeDraco = () => draco.dispose();
  }
  if (preflight.needsMeshopt) {
    const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
    await MeshoptDecoder.ready;
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  throwIfAborted(signal);
  try {
    // parseAsync accepts an already parsed JSON object at runtime; the typings only list string/ArrayBuffer.
    const gltf = await loader.parseAsync(data as ArrayBuffer, "");
    const root = gltf.scene ?? gltf.scenes[0];
    if (!root) throw new ThreeAdapterError("no-geometry", "This glTF file contains no scene.");
    return { root, placeholderMaterials: false, notes: [] };
  } catch (error) {
    if (error instanceof ThreeAdapterError) throw error;
    throw new ThreeAdapterError("invalid", `This glTF file could not be read: ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    disposeDraco?.();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
  return String(error);
}

function placeholder(name = ""): MeshStandardMaterial {
  const material = new MeshStandardMaterial();
  material.name = name;
  return material;
}

async function parseStl(bytes: Uint8Array, options: ResolvedOptions): Promise<ParsedModel> {
  inspectStl(bytes, options.maxSourceTriangles);
  const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
  const geometry = new STLLoader().parse(ownBuffer(bytes));
  const names = (geometry.userData.groupNames as string[] | undefined) ?? [];
  const material: Material | Material[] =
    geometry.groups.length > 1 ? geometry.groups.map((_, i) => placeholder(names[i] ?? "")) : placeholder();
  const root = new Group();
  root.add(new Mesh(geometry, material));
  return { root, placeholderMaterials: true, notes: [] };
}

async function parsePly(bytes: Uint8Array, options: ResolvedOptions): Promise<ParsedModel> {
  const header = inspectPly(bytes, options.maxSourceTriangles * 3);
  const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
  const geometry: BufferGeometry = new PLYLoader().parse(ownBuffer(bytes));
  const root = new Group();
  const notes: string[] = [];
  if (header.splat) notes.push("Gaussian splat attributes are not rendered; showing splat centres as points");
  const faces = geometry.index ? geometry.index.count / 3 : 0;
  if (faces >= 1 && !header.splat) root.add(new Mesh(geometry, placeholder()));
  else {
    geometry.setIndex(null);
    root.add(new Points(geometry, placeholder()));
  }
  return { root, placeholderMaterials: true, notes };
}

async function parseObj(bytes: Uint8Array): Promise<ParsedModel> {
  const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
  const root = new OBJLoader().parse(decodeText(bytes));
  const notes = /^mtllib\s/m.test(decodeText(bytes.subarray(0, 65536)))
    ? ["MTL materials and textures are not loaded from OBJ files; a palette is used instead"]
    : [];
  return { root, placeholderMaterials: true, notes };
}

/**
 * Parses model bytes into a three.js scene. Everything is offline: glTF files that reference
 * external files are rejected, decoders are imported only when the file needs them.
 */
export async function parseModel(
  format: ThreeFormat,
  bytes: Uint8Array,
  options: ResolvedOptions,
  signal?: AbortSignal,
): Promise<ParsedModel> {
  let parsed: ParsedModel;
  switch (format) {
    case "glb":
      parsed = await parseGltf(ownBuffer(bytes), readGlbJson(bytes), options, signal);
      break;
    case "gltf": {
      let json: unknown;
      try {
        json = JSON.parse(decodeText(bytes));
      } catch (error) {
        throw new ThreeAdapterError("invalid", "This glTF file is not valid JSON.", { cause: error });
      }
      parsed = await parseGltf(json as Record<string, unknown>, json, options, signal);
      break;
    }
    case "stl":
      parsed = await parseStl(bytes, options);
      break;
    case "ply":
      parsed = await parsePly(bytes, options);
      break;
    case "obj":
      parsed = await parseObj(bytes);
      break;
  }
  if (format === "stl" || format === "ply" || format === "obj") {
    if (options.upAxis[format] === "z") parsed.root.rotation.x = -Math.PI / 2;
  }
  throwIfAborted(signal);
  return parsed;
}
