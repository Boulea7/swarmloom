/** Canvas plumbing: device-pixel budgets, PNG encoding and the ink scan readback. */

import { detectPaper, type InkMap, inkMap, type Rgb } from "./coverage";
import { PdfAdapterError } from "./errors";

/** Largest canvas side every target browser accepts (iOS Safari caps area and sides lower than desktop). */
const MAX_SIDE = 8192;

/**
 * Device pixels per CSS px for a page of `w x h` CSS px: the requested ratio,
 * lowered until the bitmap fits `maxPixels` and the canvas side limit.
 */
export function fitRatio(w: number, h: number, requested: number, maxPixels: number): number {
  const byArea = Math.sqrt(maxPixels / Math.max(1, w * h));
  return Math.max(0.25, Math.min(requested, byArea, MAX_SIDE / Math.max(1, w), MAX_SIDE / Math.max(1, h)));
}

export function context2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently });
  if (!ctx) throw new PdfAdapterError("render", "Canvas 2D is not available in this environment");
  return ctx;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PdfAdapterError("render", "Page bitmap encoding failed"))),
      "image/png",
    );
  });
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new PdfAdapterError("render", "Page bitmap encoding failed"));
    reader.readAsDataURL(blob);
  });
}

/** Encodes the canvas as lossless PNG (keeps glyph edges exact) and returns a blob: or data: URL. */
export async function encodePng(canvas: HTMLCanvasElement, urlType: "blob" | "data"): Promise<string> {
  const blob = await toBlob(canvas);
  return urlType === "blob" ? URL.createObjectURL(blob) : toDataUrl(blob);
}

export interface InkScan {
  paper: Rgb;
  map: InkMap;
}

/**
 * Downsamples the rendered page to about one pixel per CSS px on `scan` and
 * builds its ink map. The downsample keeps hairlines visible as light grey.
 */
export function scanInk(page: HTMLCanvasElement, scan: HTMLCanvasElement, cssW: number, cssH: number): InkScan {
  const w = Math.max(1, Math.ceil(cssW));
  const h = Math.max(1, Math.ceil(cssH));
  scan.width = w;
  scan.height = h;
  const ctx = context2d(scan, true);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(page, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const paper = detectPaper(px, w, h);
  return { paper, map: inkMap(px, w, h, paper) };
}

/** `#rrggbb` of a colour. */
export function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance 0..1 (sRGB, WCAG formula). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
