import type { DocImageRun } from "../model";
import type { ByteReader } from "./reader";

const PICF_SIZE = 0x44;
const MM_SHAPEFILE = 0x66;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 6;

type Raster = { mime: "image/png" | "image/jpeg"; bytes: Uint8Array };

/**
 * Returns a resolver for inline pictures (sprmCPicLocation offsets into the Data stream).
 * Only PNG and JPEG BLIPs are extracted; metafiles, DIBs and linked pictures resolve to null.
 */
export function createPictureResolver(data: ByteReader | null): (offset: number) => DocImageRun | null {
  const cache = new Map<number, DocImageRun | null>();
  return (offset) => {
    if (!data) return null;
    if (!cache.has(offset)) cache.set(offset, readPicture(data, offset));
    return cache.get(offset) ?? null;
  };
}

function readPicture(data: ByteReader, offset: number): DocImageRun | null {
  if (!data.has(offset, PICF_SIZE)) return null;
  const lcb = data.i32(offset);
  const cbHeader = data.u16(offset + 4);
  if (cbHeader !== PICF_SIZE || lcb <= PICF_SIZE || !data.has(offset, lcb)) return null;
  const mm = data.i16(offset + 6);
  const dxaGoal = data.i16(offset + 28);
  const dyaGoal = data.i16(offset + 30);
  const mx = data.u16(offset + 32) || 1000;
  const my = data.u16(offset + 34) || 1000;
  let at = offset + PICF_SIZE;
  if (mm === MM_SHAPEFILE) at += 1 + data.u8(at);
  const raster = findRaster(data, at, offset + lcb, 0);
  if (!raster) return null;
  const width = Math.round((dxaGoal * mx) / 1000);
  const height = Math.round((dyaGoal * my) / 1000);
  if (width <= 0 || height <= 0) return null;
  return { kind: "image", src: `data:${raster.mime};base64,${base64(raster.bytes)}`, width, height };
}

/** Walks OfficeArt records in [at, end) and returns the first PNG or JPEG BLIP. */
function findRaster(data: ByteReader, at: number, end: number, depth: number): Raster | null {
  while (at + 8 <= end) {
    const verInst = data.u16(at);
    const type = data.u16(at + 2);
    const len = data.u32(at + 4);
    const body = at + 8;
    if (body + len > end) return null;
    if ((verInst & 0x0f) === 0x0f && depth < MAX_DEPTH) {
      const nested = findRaster(data, body, body + len, depth + 1);
      if (nested) return nested;
    } else if (type === 0xf007 && len > 36 && depth < MAX_DEPTH) {
      // OfficeArtFBSE: 36-byte header, optional name, then the embedded BLIP record.
      const nested = findRaster(data, body + 36 + data.u8(body + 33), body + len, depth + 1);
      if (nested) return nested;
    } else {
      const raster = blip(data, type, verInst >> 4, body, len);
      if (raster) return raster;
    }
    at = body + len;
  }
  return null;
}

function blip(data: ByteReader, type: number, inst: number, body: number, len: number): Raster | null {
  let mime: Raster["mime"];
  let twoUids: boolean;
  if (type === 0xf01e) {
    mime = "image/png";
    twoUids = inst === 0x6e1;
  } else if (type === 0xf01d) {
    mime = "image/jpeg";
    twoUids = inst === 0x46b || inst === 0x6e3;
  } else {
    return null;
  }
  const header = (twoUids ? 32 : 16) + 1;
  if (len <= header || len - header > MAX_IMAGE_BYTES) return null;
  const bytes = data.slice(body + header, len - header, "picture");
  const ok = mime === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 : bytes[0] === 0xff && bytes[1] === 0xd8;
  return ok ? { mime, bytes } : null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
