/**
 * Pixel sizes of base64 PNG, JPEG and GIF images, read from their headers so outputs can be laid
 * out before the images decode.
 */

import type { ImageMime } from "./nbformat";

export interface PixelSize {
  w: number;
  h: number;
}

/** JPEG headers (EXIF, ICC profiles) can be long; this many bytes are scanned for the frame header. */
const JPEG_SCAN = 256 * 1024;

/** Decodes the first `bytes` bytes of a base64 string (the string is assumed valid). */
export function base64Head(data: string, bytes: number): Uint8Array {
  const chars = Math.min(data.length, Math.ceil(bytes / 3) * 4);
  let bin: string;
  try {
    bin = atob(data.slice(0, chars));
  } catch {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number): number => (u16be(b, i) * 65536 + u16be(b, i + 2)) >>> 0;
const u16le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);

function pngSize(b: Uint8Array): PixelSize | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
  // IHDR is always the first chunk.
  if (String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0) !== "IHDR") return null;
  return { w: u32be(b, 16), h: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): PixelSize | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] as number;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { w: u16be(b, i + 7), h: u16be(b, i + 5) };
    if (marker === 0xda || marker === 0xd9) return null;
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function gifSize(b: Uint8Array): PixelSize | null {
  if (b.length < 10 || String.fromCharCode(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0) !== "GIF8") return null;
  return { w: u16le(b, 6), h: u16le(b, 8) };
}

/** Pixel size of a base64 image, or null when the header is not what `mime` says. */
export function imageSize(mime: ImageMime, data: string): PixelSize | null {
  const head = base64Head(data, mime === "image/jpeg" ? JPEG_SCAN : 32);
  const size = mime === "image/png" ? pngSize(head) : mime === "image/jpeg" ? jpegSize(head) : gifSize(head);
  if (!size || size.w < 1 || size.h < 1 || size.w > 30_000 || size.h > 30_000) return null;
  return size;
}

/** The image MIME type of a `data:` URL, when it is a base64 PNG, JPEG or GIF. */
export function dataUrlImage(url: string): { mime: ImageMime; data: string } | null {
  const m = /^data:(image\/(?:png|jpeg|jpg|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(url.trim());
  if (!m) return null;
  const type = (m[1] as string).toLowerCase();
  const mime: ImageMime = type === "image/png" ? "image/png" : type === "image/gif" ? "image/gif" : "image/jpeg";
  return { mime, data: m[2] as string };
}
