import type { Size } from "@swarmloom/core";

/** A 2D drawing surface: OffscreenCanvas when available, otherwise a detached `<canvas>`. */
type Surface = OffscreenCanvas | HTMLCanvasElement;

function createSurface(doc: Document, w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = doc.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function context2d(surface: Surface): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = surface.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Canvas 2D is not available to decode the image");
  return ctx;
}

/** Decodes an image blob (first frame for animations, EXIF orientation applied). */
export async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function")
    throw new Error("This environment cannot decode images (createImageBitmap)");
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none" });
  } catch (error) {
    const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new Error(`The image could not be decoded (corrupt or unsupported by this browser)${reason}`);
  }
}

/** RGBA pixels of `bitmap` scaled to `size` with high-quality resampling. */
export function readPixels(doc: Document, bitmap: ImageBitmap, size: Size): Uint8ClampedArray {
  const surface = createSurface(doc, size.w, size.h);
  const ctx = context2d(surface);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.w, size.h);
  return ctx.getImageData(0, 0, size.w, size.h).data;
}

async function encode(surface: Surface, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in surface) return surface.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => {
    surface.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image"))), type, quality);
  });
}

/**
 * Re-encodes `bitmap` at `size` (a still image: animations keep their first frame). WebP keeps
 * alpha and is compact; engines without a WebP encoder fall back to PNG.
 */
export async function encodeStill(doc: Document, bitmap: ImageBitmap, size: Size): Promise<Blob> {
  const surface = createSurface(doc, size.w, size.h);
  const ctx = context2d(surface);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.w, size.h);
  const webp = await encode(surface, "image/webp", 0.92);
  return webp.type === "image/webp" ? webp : encode(surface, "image/png", 1);
}

/** Scales `natural` down so its longer side is at most `maxSide` (never up). */
export function fitWithin(natural: Size, maxSide: number): Size {
  const k = Math.min(1, maxSide / Math.max(natural.w, natural.h));
  return { w: Math.max(1, Math.round(natural.w * k)), h: Math.max(1, Math.round(natural.h * k)) };
}
