import type { UnzipFileInfo } from "fflate";
import { LIMITS } from "./constants";
import { LottieError } from "./errors";
import { formatBytes, isRecord, parseJson } from "./lottie/json";

/** The animation chosen from a dotLottie archive, with its images inlined as data URLs. */
export interface DotLottieContent {
  /** Animation id from the manifest (or the file name). */
  id: string;
  /** Lottie JSON text of the animation. */
  animation: string;
  /** Image file name (no folder) -> data URL. */
  images: ReadonlyMap<string, string>;
  /** Manifest `loop` of the animation (v1): true, false or a number of plays. */
  loop?: boolean | number;
  /** Manifest playback speed (v1), 0.1-8. */
  speed?: number;
  /** Manifest background colour (v2). */
  background?: string;
  notes: string[];
}

/** Limits of {@link unpackDotLottie}. */
export interface DotLottieOptions {
  /** Animation id to pick; default: the manifest's active/initial animation, then the first. */
  animationId?: string;
  maxArchiveBytes?: number;
  maxUnpackedBytes?: number;
  maxEntries?: number;
  /** Largest animation JSON, bytes. */
  maxBytes?: number;
  maxImageBytes?: number;
}

const MANIFEST = "manifest.json";
const ANIMATION = /^(?:animations|a)\/([\w.-]{1,128})\.json$/;
const IMAGE = /^(?:images|i)\/([\w.\- ]{1,200})$/;
const ID = /^[\w.-]{1,128}$/;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};
/** Entries above this size must not expand more than LIMITS.maxRatio times. */
const RATIO_FLOOR = 1024 * 1024;

/** Rejects names that would escape a folder if the archive were ever written to disk. */
function assertSafeName(name: string): void {
  if (name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.split("/").includes("..")) {
    throw new LottieError("archive", `The .lottie archive contains an unsafe path ("${name.slice(0, 80)}").`);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function imageDataUrl(name: string, bytes: Uint8Array): string | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const type = IMAGE_TYPES[ext];
  return type ? `data:${type};base64,${toBase64(bytes)}` : null;
}

interface ManifestEntry {
  id: string;
  loop?: boolean | number;
  speed?: number;
  background?: string;
}

interface Manifest {
  animations: ManifestEntry[];
  active?: string;
}

function readManifest(bytes: Uint8Array | undefined): Manifest {
  if (!bytes) return { animations: [] };
  const data = parseJson(new TextDecoder().decode(bytes), { maxBytes: 1024 * 1024, maxDepth: 64 }, "dotLottie manifest");
  if (!isRecord(data)) throw new LottieError("archive", "The .lottie manifest is not a JSON object.");
  const animations: ManifestEntry[] = [];
  if (Array.isArray(data.animations)) {
    for (const a of data.animations) {
      if (!isRecord(a) || typeof a.id !== "string" || !ID.test(a.id)) continue;
      const entry: ManifestEntry = { id: a.id };
      if (typeof a.loop === "boolean") entry.loop = a.loop;
      else if (typeof a.loop === "number" && Number.isInteger(a.loop) && a.loop >= 0) entry.loop = a.loop;
      if (typeof a.speed === "number" && a.speed >= 0.1 && a.speed <= 8) entry.speed = a.speed;
      if (typeof a.background === "string" && /^#[0-9a-f]{3,8}$/i.test(a.background)) entry.background = a.background;
      animations.push(entry);
    }
  }
  const initial = isRecord(data.initial) ? data.initial.animation : undefined;
  const active = typeof data.activeAnimationId === "string" ? data.activeAnimationId : initial;
  return typeof active === "string" ? { animations, active } : { animations };
}

/**
 * Unpacks a dotLottie archive (v1 `animations/` + `images/`, or v2 `a/` + `i/`) and returns one
 * animation with its images. Only the manifest, animation JSON and images are decompressed;
 * every other entry (themes, state machines, fonts, audio) is skipped.
 *
 * Limits: archive size, entry count, total and per-entry unpacked size, compression ratio,
 * and safe entry names. fflate is loaded on first use.
 *
 * @throws LottieError ("archive" / "too-large") with a user-facing message.
 */
export async function unpackDotLottie(bytes: Uint8Array, options: DotLottieOptions = {}): Promise<DotLottieContent> {
  const maxArchive = options.maxArchiveBytes ?? LIMITS.maxArchiveBytes;
  const maxUnpacked = options.maxUnpackedBytes ?? LIMITS.maxUnpackedBytes;
  const maxEntries = options.maxEntries ?? LIMITS.maxEntries;
  const maxJson = options.maxBytes ?? LIMITS.maxBytes;
  const maxImage = options.maxImageBytes ?? LIMITS.maxImageBytes;
  if (bytes.length > maxArchive) {
    throw new LottieError("too-large", `The .lottie file is ${formatBytes(bytes.length)} (the limit is ${formatBytes(maxArchive)}).`);
  }
  const { unzipSync } = await import("fflate");

  let entries = 0;
  let unpacked = 0;
  const filter = (file: UnzipFileInfo): boolean => {
    if (++entries > maxEntries) throw new LottieError("too-large", `The .lottie archive has more than ${maxEntries} entries.`);
    assertSafeName(file.name);
    const isManifest = file.name === MANIFEST;
    const isAnimation = ANIMATION.test(file.name);
    const isImage = IMAGE.test(file.name);
    if (!isManifest && !isAnimation && !isImage) return false;
    const cap = isImage ? maxImage : maxJson;
    if (file.originalSize > cap) {
      throw new LottieError("too-large", `"${file.name}" unpacks to ${formatBytes(file.originalSize)} (the limit is ${formatBytes(cap)}).`);
    }
    if (file.originalSize > RATIO_FLOOR && file.originalSize / Math.max(1, file.size) > LIMITS.maxRatio) {
      throw new LottieError("archive", `"${file.name}" is compressed suspiciously well; the archive was rejected.`);
    }
    if (file.compression !== 0 && file.compression !== 8) {
      throw new LottieError("archive", `"${file.name}" uses an unsupported ZIP compression method (${file.compression}).`);
    }
    unpacked += file.originalSize;
    if (unpacked > maxUnpacked) {
      throw new LottieError("too-large", `The .lottie archive unpacks to more than ${formatBytes(maxUnpacked)}.`);
    }
    return true;
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter });
  } catch (err) {
    if (err instanceof LottieError) throw err;
    throw new LottieError("archive", "The .lottie file is not a readable ZIP archive.", { cause: err });
  }

  const manifest = readManifest(files[MANIFEST]);
  const available = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    const m = ANIMATION.exec(name);
    if (m?.[1] && !available.has(m[1])) available.set(m[1], data);
  }
  if (available.size === 0) throw new LottieError("archive", "The .lottie archive contains no animation.");

  const wanted = [options.animationId, manifest.active, ...manifest.animations.map((a) => a.id)];
  const id = wanted.find((w): w is string => typeof w === "string" && available.has(w)) ?? [...available.keys()].sort()[0];
  if (id === undefined) throw new LottieError("archive", "The .lottie archive contains no animation.");
  if (options.animationId && id !== options.animationId) {
    throw new LottieError("archive", `The .lottie archive has no animation "${options.animationId}".`);
  }

  const notes: string[] = [];
  if (!files[MANIFEST]) notes.push("The .lottie archive has no manifest; its first animation is shown.");
  if (available.size > 1) notes.push(`This .lottie holds ${available.size} animations; "${id}" is shown.`);

  const images = new Map<string, string>();
  let skipped = 0;
  for (const [name, data] of Object.entries(files)) {
    const m = IMAGE.exec(name);
    if (!m?.[1]) continue;
    const url = imageDataUrl(m[1], data);
    if (url) images.set(m[1], url);
    else skipped++;
  }
  if (skipped > 0) notes.push(`${skipped} image(s) in an unsupported format were left out.`);

  const entry = manifest.animations.find((a) => a.id === id);
  const content: DotLottieContent = {
    id,
    animation: new TextDecoder().decode(available.get(id)),
    images,
    notes,
  };
  if (entry?.loop !== undefined) content.loop = entry.loop;
  if (entry?.speed !== undefined) content.speed = entry.speed;
  if (entry?.background !== undefined) content.background = entry.background;
  return content;
}

/**
 * Resolves an image asset path of an animation inside a dotLottie archive (`/images/x.png`,
 * `i/x.png`, `x.png`) to its data URL.
 */
export function resolveArchiveImage(images: ReadonlyMap<string, string>, path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return images.get(name);
}
