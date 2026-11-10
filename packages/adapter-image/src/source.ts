import type { SourceInput } from "@swarmloom/core";

/** Raster formats the adapter recognises from their signature. */
export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "avif" | "bmp";

export const MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

/** What the container header says, read without decoding pixels. */
export interface ImageProbe {
  format: ImageFormat;
  /** Pixel size from the header when the format makes it cheap to read. */
  width?: number;
  height?: number;
  /** True for animated GIF/PNG/WebP/AVIF; only the first frame is used. */
  animated: boolean;
}

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i] as number);
  return s;
}

function u16le(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}

function u16be(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}

function u24le(b: Uint8Array, at: number): number {
  return u16le(b, at) | ((b[at + 2] ?? 0) << 16);
}

function u32be(b: Uint8Array, at: number): number {
  return (u16be(b, at) * 0x10000 + u16be(b, at + 2)) >>> 0;
}

function i32le(b: Uint8Array, at: number): number {
  return u16le(b, at) | (u16le(b, at + 2) << 16) | 0;
}

/** Identifies the format from the first bytes; null when unknown. */
export function sniffFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brands = ascii(b, 8, Math.min(32, b.length - 8));
    if (brands.includes("avif") || brands.includes("avis")) return "avif";
  }
  if (b.length >= 26 && ascii(b, 0, 2) === "BM") return "bmp";
  return null;
}

function probePng(b: Uint8Array, p: ImageProbe): void {
  if (ascii(b, 12, 4) === "IHDR") {
    p.width = u32be(b, 16);
    p.height = u32be(b, 20);
  }
  // An acTL chunk before the first IDAT marks an animated PNG.
  let at = 8;
  for (let guard = 0; guard < 64 && at + 8 <= b.length; guard++) {
    const len = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    if (type === "acTL") p.animated = true;
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + len;
  }
}

function probeJpeg(b: Uint8Array, p: ImageProbe): void {
  let at = 2;
  for (let guard = 0; guard < 512 && at + 9 < b.length; guard++) {
    if (b[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = b[at + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    // SOFn frames (excluding DHT/JPG/DAC) carry the image size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      p.height = u16be(b, at + 5);
      p.width = u16be(b, at + 7);
      return;
    }
    if (marker === 0xda) return;
    at += 2 + u16be(b, at + 2);
  }
}

/** Skips GIF data sub-blocks starting at `at`; returns the offset after the terminator or -1. */
function skipGifSubBlocks(b: Uint8Array, at: number): number {
  let i = at;
  while (i < b.length) {
    const size = b[i] as number;
    if (size === 0) return i + 1;
    i += size + 1;
  }
  return -1;
}

function probeGif(b: Uint8Array, p: ImageProbe): void {
  p.width = u16le(b, 6);
  p.height = u16le(b, 8);
  // Walk the block structure and count image descriptors: two or more frames means animation.
  const packed = b[10] ?? 0;
  let at = 13 + ((packed & 0x80) !== 0 ? 3 << ((packed & 7) + 1) : 0);
  let frames = 0;
  while (at > 0 && at < b.length && frames < 2) {
    const introducer = b[at];
    if (introducer === 0x21) {
      at = skipGifSubBlocks(b, at + 2);
    } else if (introducer === 0x2c) {
      frames++;
      const local = b[at + 9] ?? 0;
      at += 10 + ((local & 0x80) !== 0 ? 3 << ((local & 7) + 1) : 0);
      // LZW minimum code size, then the image data sub-blocks.
      at = skipGifSubBlocks(b, at + 1);
    } else {
      break;
    }
  }
  p.animated = frames > 1;
}

function probeWebp(b: Uint8Array, p: ImageProbe): void {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b.length >= 30) {
    p.width = u16le(b, 26) & 0x3fff;
    p.height = u16le(b, 28) & 0x3fff;
  } else if (chunk === "VP8L" && b.length >= 25) {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    p.width = (bits & 0x3fff) + 1;
    p.height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === "VP8X" && b.length >= 30) {
    p.animated = ((b[20] ?? 0) & 0x02) !== 0;
    p.width = u24le(b, 24) + 1;
    p.height = u24le(b, 27) + 1;
  }
}

function probeAvif(b: Uint8Array, p: ImageProbe): void {
  p.animated = ascii(b, 8, Math.min(32, b.length - 8)).includes("avis");
  // The `ispe` property box holds the image size.
  const limit = Math.min(b.length - 20, 64 * 1024);
  for (let i = 0; i < limit; i++) {
    if (b[i] === 0x69 && ascii(b, i, 4) === "ispe") {
      p.width = u32be(b, i + 8);
      p.height = u32be(b, i + 12);
      return;
    }
  }
}

function probeBmp(b: Uint8Array, p: ImageProbe): void {
  p.width = Math.abs(i32le(b, 18));
  p.height = Math.abs(i32le(b, 22));
}

/** Reads format, size and animation from the header. Null for unknown formats. */
export function probeImage(b: Uint8Array): ImageProbe | null {
  const format = sniffFormat(b);
  if (!format) return null;
  const p: ImageProbe = { format, animated: false };
  if (format === "png") probePng(b, p);
  else if (format === "jpeg") probeJpeg(b, p);
  else if (format === "gif") probeGif(b, p);
  else if (format === "webp") probeWebp(b, p);
  else if (format === "avif") probeAvif(b, p);
  else probeBmp(b, p);
  return p;
}

function tooLarge(n: number, max: number): RangeError {
  return new RangeError(`Image file is too large (${n} bytes, limit ${max})`);
}

/** Reads the bytes of a source input from `bytes` or a fetched `url`. */
export async function readImageBytes(input: SourceInput, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (input.bytes instanceof Uint8Array) {
    if (input.bytes.byteLength > maxBytes) throw tooLarge(input.bytes.byteLength, maxBytes);
    return input.bytes;
  }
  if (typeof input.url === "string" && input.url) {
    const res = await fetch(input.url, { signal });
    if (!res.ok) throw new Error(`Could not fetch the image (${res.status} ${res.statusText})`.trim());
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw tooLarge(declared, maxBytes);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge(bytes.byteLength, maxBytes);
    return bytes;
  }
  throw new TypeError("The image adapter needs bytes or a URL");
}
