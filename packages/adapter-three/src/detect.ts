import { ThreeAdapterError } from "./errors";
import type { ThreeFormat } from "./options";

/** File extensions handled by the adapter, lower case without the dot. */
export const EXTENSIONS: readonly ThreeFormat[] = ["glb", "gltf", "obj", "stl", "ply"];

/** MIME types handled by the adapter (registered types plus common de-facto ones). */
export const MIME_TYPES: Readonly<Record<string, ThreeFormat>> = {
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  "model/obj": "obj",
  "model/stl": "stl",
  "model/x.stl-binary": "stl",
  "model/x.stl-ascii": "stl",
  "application/sla": "stl",
  "application/vnd.ms-pki.stl": "stl",
  "model/x-ply": "ply",
  "application/ply": "ply",
};

const GLB_MAGIC = 0x46546c67; // "glTF" little endian
const GLB_JSON_CHUNK = 0x4e4f534a; // "JSON"

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  const stop = Math.min(end, bytes.length);
  for (let i = start; i < stop; i++) out += String.fromCharCode(bytes[i] as number);
  return out;
}

/** Format implied by a file name's extension, or null. */
export function formatFromName(name: string | undefined): ThreeFormat | null {
  if (!name) return null;
  const clean = name.split(/[?#]/, 1)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  return (EXTENSIONS as readonly string[]).includes(ext) ? (ext as ThreeFormat) : null;
}

/** Format implied by a MIME type (parameters ignored), or null. */
export function formatFromMime(type: string | undefined): ThreeFormat | null {
  if (!type) return null;
  const base = type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPES[base] ?? null;
}

const OBJ_LINE = /^(v|vn|vt|f|o|g|s|l|p|mtllib|usemtl)\s/;

/** True when the text looks like Wavefront OBJ: at least two statements and no foreign first line. */
function looksLikeObj(text: string): boolean {
  let statements = 0;
  for (const raw of text.split(/\r?\n/, 64)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!OBJ_LINE.test(line)) return false;
    statements++;
    if (statements >= 2) return true;
  }
  return false;
}

/**
 * Content sniffing on the first bytes. Strong signatures (GLB magic, PLY header, glTF JSON,
 * ASCII STL) are recognised; OBJ only when the first statements are unmistakably OBJ.
 * Binary STL has no signature and is recognised by extension or MIME type only.
 */
export function sniffFormat(head: Uint8Array): ThreeFormat | null {
  if (head.length >= 4) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (view.getUint32(0, true) === GLB_MAGIC) return "glb";
  }
  const start = ascii(head, 0, 512).replace(/^﻿/, "");
  if (/^ply\r?\n/.test(start)) return "ply";
  const trimmed = start.trimStart();
  if (trimmed.startsWith("{") && /"asset"\s*:/.test(start)) return "gltf";
  if (/^solid\b/.test(trimmed) && /\bfacet\b|\bendsolid\b/.test(start)) return "stl";
  if (looksLikeObj(start)) return "obj";
  return null;
}

/** Resolves the format from content first, then file name, then MIME type. */
export function detectFormat(input: { name?: string; type?: string; head?: Uint8Array }): ThreeFormat | null {
  const sniffed = input.head ? sniffFormat(input.head) : null;
  return sniffed ?? formatFromName(input.name) ?? formatFromMime(input.type);
}

/** Decodes UTF-8 text, dropping a byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/* ------------------------------------------------------------------ */
/* glTF preflight                                                      */
/* ------------------------------------------------------------------ */

/** Extensions three's GLTFLoader implements out of the box (r187). */
const SUPPORTED_GLTF_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "KHR_lights_punctual",
  "KHR_materials_anisotropy",
  "KHR_materials_clearcoat",
  "KHR_materials_diffuse_roughness",
  "KHR_materials_dispersion",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_iridescence",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_unlit",
  "KHR_materials_volume",
  "KHR_mesh_quantization",
  "KHR_meshopt_compression",
  "KHR_texture_transform",
  "EXT_materials_bump",
  "EXT_meshopt_compression",
  "EXT_mesh_gpu_instancing",
  "EXT_texture_avif",
  "EXT_texture_webp",
]);

/** What a glTF document needs before it can be parsed offline. */
export interface GltfPreflight {
  needsDraco: boolean;
  needsMeshopt: boolean;
  /** URIs of buffers/images that are neither embedded (data:) nor in the GLB binary chunk. */
  external: string[];
  /** Required extensions no available loader implements. */
  unsupported: string[];
}

/** Bytes per component for glTF accessor componentType codes. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Validates a parsed glTF JSON document and reports what it needs.
 *
 * Rejects (throws) non-2.x assets and accessor declarations whose total size exceeds
 * `maxDeclaredBytes`: sparse accessors allocate their declared count even without data,
 * so the declaration itself must be bounded before three allocates anything.
 */
export function inspectGltf(json: unknown, maxDeclaredBytes: number): GltfPreflight {
  if (!isRecord(json) || !isRecord(json.asset) || typeof json.asset.version !== "string") {
    throw new ThreeAdapterError("invalid", "This glTF file has no asset version; it is not a valid glTF 2.0 document.");
  }
  const major = Number.parseInt(json.asset.version, 10);
  if (major !== 2) {
    throw new ThreeAdapterError("unsupported-format", `glTF ${json.asset.version} is not supported; only glTF 2.0 is.`);
  }
  const used = new Set([...stringList(json.extensionsUsed), ...stringList(json.extensionsRequired)]);
  const required = stringList(json.extensionsRequired);
  const unsupported = required.filter((name) => !SUPPORTED_GLTF_EXTENSIONS.has(name));

  const external: string[] = [];
  for (const key of ["buffers", "images"] as const) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (isRecord(item) && typeof item.uri === "string" && !item.uri.startsWith("data:")) external.push(item.uri);
    }
  }

  let declared = 0;
  if (Array.isArray(json.accessors)) {
    for (const accessor of json.accessors) {
      if (!isRecord(accessor)) continue;
      const count = typeof accessor.count === "number" ? accessor.count : 0;
      const size = TYPE_SIZE[String(accessor.type)] ?? 16;
      const bytes = COMPONENT_BYTES[Number(accessor.componentType)] ?? 4;
      if (!Number.isFinite(count) || count < 0) {
        throw new ThreeAdapterError("invalid", "This glTF file declares an accessor with an invalid count.");
      }
      declared += count * size * bytes;
    }
  }
  if (declared > maxDeclaredBytes) {
    throw new ThreeAdapterError(
      "too-large",
      `This glTF file declares ${Math.round(declared / 1048576)} MiB of vertex data, more than the ${Math.round(maxDeclaredBytes / 1048576)} MiB limit.`,
    );
  }
  return {
    needsDraco: used.has("KHR_draco_mesh_compression"),
    needsMeshopt: used.has("EXT_meshopt_compression") || used.has("KHR_meshopt_compression"),
    external,
    unsupported,
  };
}

/** Extracts and parses the JSON chunk of a binary glTF container, with bounds checks. */
export function readGlbJson(bytes: Uint8Array): unknown {
  if (bytes.length < 20) throw new ThreeAdapterError("invalid", "This GLB file is truncated (no header).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC)
    throw new ThreeAdapterError("invalid", "This file is not a GLB container.");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new ThreeAdapterError("unsupported-format", `GLB version ${version} is not supported.`);
  const length = view.getUint32(8, true);
  if (length > bytes.length) throw new ThreeAdapterError("invalid", "This GLB file is truncated.");
  const chunkLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== GLB_JSON_CHUNK || 20 + chunkLength > length) {
    throw new ThreeAdapterError("invalid", "This GLB file has no valid JSON chunk.");
  }
  try {
    return JSON.parse(decodeText(bytes.subarray(20, 20 + chunkLength)));
  } catch (error) {
    throw new ThreeAdapterError("invalid", "The JSON chunk of this GLB file is malformed.", { cause: error });
  }
}

/* ------------------------------------------------------------------ */
/* PLY and STL preflight                                               */
/* ------------------------------------------------------------------ */

/** Facts read from a PLY header before handing the file to the loader. */
export interface PlyHeader {
  encoding: "ascii" | "binary_little_endian" | "binary_big_endian";
  vertices: number;
  faces: number;
  /** Gaussian-splat attributes present (scale/rotation/SH): only centres can be shown. */
  splat: boolean;
}

const PLY_SCALAR_BYTES: Readonly<Record<string, number>> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

/**
 * Parses and bounds-checks a PLY header. Rejects element counts above `maxElements` and binary
 * files too short for their declared vertices, so the loader never allocates for a lie.
 */
export function inspectPly(bytes: Uint8Array, maxElements: number): PlyHeader {
  const headText = ascii(bytes, 0, 65536);
  const end = headText.search(/end_header\r?\n/);
  if (!headText.startsWith("ply") || end < 0)
    throw new ThreeAdapterError("invalid", "This PLY file has no valid header.");
  let encoding: PlyHeader["encoding"] | null = null;
  let vertices = 0;
  let faces = 0;
  let vertexStride = 0;
  let current = "";
  const vertexProps = new Set<string>();
  for (const raw of headText.slice(0, end).split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === "format") {
      const value = parts[1];
      if (value === "ascii" || value === "binary_little_endian" || value === "binary_big_endian") encoding = value;
    } else if (parts[0] === "element") {
      current = parts[1] ?? "";
      const count = Number(parts[2]);
      if (!Number.isInteger(count) || count < 0)
        throw new ThreeAdapterError("invalid", "This PLY header has an invalid element count.");
      if (count > maxElements) {
        throw new ThreeAdapterError(
          "too-large",
          `This PLY file declares ${count} ${current} elements (limit ${maxElements}).`,
        );
      }
      if (current === "vertex") vertices = count;
      if (current === "face") faces = count;
    } else if (parts[0] === "property" && current === "vertex") {
      const type = parts[1] ?? "";
      if (type !== "list") vertexStride += PLY_SCALAR_BYTES[type] ?? 4;
      vertexProps.add(parts[parts.length - 1] ?? "");
    }
  }
  if (!encoding) throw new ThreeAdapterError("invalid", "This PLY header has no supported format line.");
  if (encoding !== "ascii" && end + vertices * vertexStride > bytes.length) {
    throw new ThreeAdapterError("invalid", "This PLY file is shorter than its header declares.");
  }
  const splat = vertexProps.has("f_dc_0") || (vertexProps.has("scale_0") && vertexProps.has("rot_0"));
  return { encoding, vertices, faces, splat };
}

/** Checks a binary STL's declared triangle count against the limit and the byte length. */
export function inspectStl(bytes: Uint8Array, maxTriangles: number): { binary: boolean; triangles: number | null } {
  if (bytes.length >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(80, true);
    if (84 + count * 50 === bytes.length) {
      if (count > maxTriangles) {
        throw new ThreeAdapterError("too-large", `This STL file has ${count} triangles (limit ${maxTriangles}).`);
      }
      return { binary: true, triangles: count };
    }
  }
  const start = ascii(bytes, 0, 1024).trimStart();
  if (/^solid\b/.test(start)) return { binary: false, triangles: null };
  throw new ThreeAdapterError("invalid", "This STL file is neither valid binary STL nor ASCII STL.");
}
