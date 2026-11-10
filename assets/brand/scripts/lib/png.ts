import { inflateSync } from "node:zlib";

/** Decoded 8-bit PNG as straight RGBA. */
export interface Bitmap {
  width: number;
  height: number;
  /** Whether the file stores an alpha channel (colour type 6). */
  hasAlpha: boolean;
  /** width * height * 4 bytes, row-major RGBA. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads width and height from the IHDR chunk without decoding pixels. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) throw new Error("PNG does not start with IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decodes the subset of PNG that Chromium screenshots produce: 8-bit RGB or RGBA, not interlaced.
 * Anything else throws, so a change in the capture pipeline is noticed instead of misread.
 */
export function decodePng(bytes: Uint8Array): Bitmap {
  const { width, height } = pngSize(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`);
  }
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new Error("PNG pixel data has the wrong length");
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (out[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (out[row - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (out[row - stride + x - channels] ?? 0) : 0;
      const v = raw[src + x] ?? 0;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (left + up) >> 1;
      else if (filter === 4) pred = paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[row + x] = (v + pred) & 255;
    }
  }
  if (channels === 4) return { width, height, hasAlpha: true, rgba: out };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i] ?? 0;
    rgba[j + 1] = out[i + 1] ?? 0;
    rgba[j + 2] = out[i + 2] ?? 0;
    rgba[j + 3] = 255;
  }
  return { width, height, hasAlpha: false, rgba };
}

/** Alpha of the pixel at (x, y). */
export function alphaAt(bmp: Bitmap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) throw new Error(`pixel ${x},${y} is outside the image`);
  return bmp.rgba[(y * bmp.width + x) * 4 + 3] ?? 0;
}

/** True when every pixel is fully opaque. */
export function isOpaque(bmp: Bitmap): boolean {
  for (let i = 3; i < bmp.rgba.length; i += 4) if (bmp.rgba[i] !== 255) return false;
  return true;
}
