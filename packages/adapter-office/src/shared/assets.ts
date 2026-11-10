import type { Size } from "@swarmloom/core";

/** Image types every target browser can decode in an <img>. */
const BROWSER_IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

/** MIME type for a renderable image part name, or undefined (EMF, WMF, TIFF, ...). */
export function imageMime(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return BROWSER_IMAGE_MIME[ext];
}

/** Upper-case extension used in placeholder labels ("EMF"). */
export function extensionLabel(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toUpperCase();
}

/**
 * Natural pixel size from the image header (PNG, JPEG, GIF, BMP, WebP), without decoding.
 * Returns undefined for other formats or truncated data.
 */
export function sniffImageSize(bytes: Uint8Array): Size | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length;
  if (n >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452) {
    return { w: view.getUint32(16), h: view.getUint32(20) };
  }
  if (n >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { w: view.getUint16(6, true), h: view.getUint16(8, true) };
  }
  if (n >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { w: Math.abs(view.getInt32(18, true)), h: Math.abs(view.getInt32(22, true)) };
  }
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(view);
  if (n >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) return webpSize(view);
  return undefined;
}

function jpegSize(view: DataView): Size | undefined {
  let p = 2;
  while (p + 9 < view.byteLength) {
    if (view.getUint8(p) !== 0xff) return undefined;
    const marker = view.getUint8(p + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    const len = view.getUint16(p + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { w: view.getUint16(p + 7), h: view.getUint16(p + 5) };
    if (len < 2) return undefined;
    p += 2 + len;
  }
  return undefined;
}

function webpSize(view: DataView): Size | undefined {
  const chunk = view.getUint32(12);
  if (chunk === 0x56503820 && view.byteLength >= 30) {
    // "VP8 ": lossy, 14-bit dimensions after the frame tag.
    return { w: view.getUint16(26, true) & 0x3fff, h: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 0x5650384c && view.byteLength >= 25) {
    // "VP8L": lossless, 14-bit width-1 and height-1 packed little-endian.
    const bits = view.getUint32(21, true);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 0x56503858 && view.byteLength >= 30) {
    // "VP8X": extended, 24-bit canvas width-1 and height-1.
    const w = view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
    const h = view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
    return { w: w + 1, h: h + 1 };
  }
  return undefined;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** A decodable embedded image. */
export interface EmbeddedImage {
  src: string;
  natural?: Size;
}

/** Minimal package view the store reads from (implemented by ZipArchive). */
export interface PartReader {
  has(name: string): boolean;
  read(name: string): Uint8Array;
}

/**
 * Owns the object URLs created for embedded images of one loaded file. Each part is inflated
 * and turned into a URL once, however many shapes reference it. Falls back to data: URLs
 * where `URL.createObjectURL` is unavailable.
 */
export class AssetStore {
  private readonly urls: string[] = [];
  private readonly byPart = new Map<string, EmbeddedImage | null>();

  /**
   * Image for a package part, or null when the part is missing or not a browser image type
   * (EMF, WMF, TIFF...); callers then show a labelled placeholder.
   */
  image(pkg: PartReader, part: string): EmbeddedImage | null {
    const known = this.byPart.get(part);
    if (known !== undefined) return known;
    const mime = imageMime(part);
    let image: EmbeddedImage | null = null;
    if (mime && pkg.has(part)) {
      const bytes = pkg.read(part);
      image = { src: this.url(bytes, mime), natural: sniffImageSize(bytes) };
    }
    this.byPart.set(part, image);
    return image;
  }

  private url(bytes: Uint8Array, mime: string): string {
    if (typeof URL.createObjectURL !== "function" || typeof Blob !== "function") {
      return `data:${mime};base64,${base64(bytes)}`;
    }
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    this.urls.push(url);
    return url;
  }

  /** Revokes every object URL. Safe to call more than once. */
  dispose(): void {
    for (const url of this.urls.splice(0)) URL.revokeObjectURL(url);
    this.byPart.clear();
  }
}
