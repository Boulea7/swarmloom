import type { Adapter, AdapterContext, Blueprint, LoadedSource, Size, SourceInput } from "@swarmloom/core";
import { decodeBitmap, encodeStill, fitWithin, readPixels } from "./decode";
import type { AnalyzeOptions } from "./kernel";
import { buildLayers, type LayerStyle, placeImage } from "./layers";
import { MIME, probeImage, readImageBytes, sniffFormat } from "./source";
import { analyzePixels } from "./worker-host";

/** Limits and tuning of the image adapter. */
export interface ImageAdapterOptions {
  /** Longest side of the working copy used for edge detection and tiling, px (default 512). */
  workSize?: number;
  /** Maximum pencil strokes in the sketch (default 160). */
  maxStrokes?: number;
  /** Maximum colour tiles (default 256). */
  maxTiles?: number;
  /** Smallest tile side in working px (default 8). */
  minTile?: number;
  /** Ramer-Douglas-Peucker tolerance in working px (default 1.2). */
  epsilon?: number;
  /** Strokes shorter than this many working px are dropped (default 10). */
  minStrokeLength?: number;
  /** Maximum file size in bytes (default 50 MiB). */
  maxBytes?: number;
  /** Maximum decoded pixel count (default 64 megapixels); larger images are rejected before decoding. */
  maxPixels?: number;
  /** Longest side of the displayed image, px; larger images are re-encoded smaller (default 4096). */
  maxDisplaySide?: number;
  /** Maximum upscale of small images to fill the layout width (default 2). */
  maxUpscale?: number;
  /** Maximum world height as a multiple of the layout width (default 4). */
  maxHeightRatio?: number;
  /** Run the pixel analysis in a Web Worker when possible (default true). */
  worker?: boolean;
  /** Worker time budget before falling back to the calling thread, ms (default 20 000). */
  workerTimeout?: number;
  /** Use data: URLs instead of blob: URLs for the image (portable blueprints; default false). */
  inlineAssets?: boolean;
}

/** Canvas colours per theme. Pencil colours are tuned for contrast against them. */
const THEMES: Record<"light" | "dark", LayerStyle & { luma: number }> = {
  light: { background: "#fafafc", pencil: "#2e2e3a", luma: 250 },
  dark: { background: "#0b0b12", pencil: "#d9d9e6", luma: 12 },
};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.readAsDataURL(blob);
  });
}

function positive(name: string, v: number): number {
  if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`ImageAdapterOptions.${name} must be a positive number`);
  return v;
}

/**
 * Creates an image adapter (PNG, JPEG, GIF first frame, WebP, AVIF, BMP). The image is decoded
 * with `createImageBitmap`, analysed at a working size (Sobel gradients, non-maximum suppression,
 * hysteresis, edge linking and Ramer-Douglas-Peucker simplification) in a Web Worker when
 * possible, and turned into:
 * 1. pencil sketch strokes: path layers drawn with the pen (`meta.sketch = true`);
 * 2. colour tiles: image layers that crop the picture along a detail-driven quadtree, biggest
 *    first, revealed with `paint`;
 * 3. the full image fading in last, so the final frame is the exact picture.
 * The world is `ctx.width` wide and as tall as the scaled image.
 */
export function createImageAdapter(options: ImageAdapterOptions = {}): Adapter {
  const workSize = Math.round(positive("workSize", options.workSize ?? 512));
  const maxStrokes = Math.floor(positive("maxStrokes", options.maxStrokes ?? 160));
  const maxTiles = Math.floor(positive("maxTiles", options.maxTiles ?? 256));
  const minTile = positive("minTile", options.minTile ?? 8);
  const epsilon = positive("epsilon", options.epsilon ?? 1.2);
  const minStrokeLength = positive("minStrokeLength", options.minStrokeLength ?? 10);
  const maxBytes = positive("maxBytes", options.maxBytes ?? 50 * 1024 * 1024);
  const maxPixels = positive("maxPixels", options.maxPixels ?? 64_000_000);
  const maxDisplaySide = Math.round(positive("maxDisplaySide", options.maxDisplaySide ?? 4096));
  const maxUpscale = positive("maxUpscale", options.maxUpscale ?? 2);
  const maxHeightRatio = positive("maxHeightRatio", options.maxHeightRatio ?? 4);
  const useWorker = options.worker ?? true;
  const workerTimeout = positive("workerTimeout", options.workerTimeout ?? 20_000);
  const inlineAssets = options.inlineAssets ?? false;

  return {
    id: "image",
    label: "Image",
    extensions: ["png", "apng", "jpg", "jpeg", "jfif", "gif", "webp", "avif", "bmp"],
    mime: ["image/png", "image/apng", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"],
    sniff(head: Uint8Array): boolean {
      return sniffFormat(head) !== null;
    },
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      if (!input || typeof input !== "object") throw new TypeError("Image adapter: input must be an object");
      if (!ctx?.document) throw new TypeError("Image adapter: ctx.document is required");
      if (!(Number.isFinite(ctx.width) && ctx.width > 0)) throw new RangeError("Image adapter: ctx.width must be > 0");
      if (ctx.maxLayers !== undefined && !(ctx.maxLayers >= 1)) {
        throw new RangeError("Image adapter: ctx.maxLayers must be >= 1");
      }
      const { signal } = ctx;
      checkAbort(signal);

      const bytes = await readImageBytes(input, maxBytes, signal);
      const probe = probeImage(bytes);
      if (!probe) throw new TypeError("Unsupported image format: expected PNG, JPEG, GIF, WebP, AVIF or BMP");
      if (probe.width && probe.height && probe.width * probe.height > maxPixels) {
        throw new RangeError(`Image is too large (${probe.width} x ${probe.height} px, limit ${maxPixels} pixels)`);
      }
      checkAbort(signal);

      const blob = new Blob([bytes as BlobPart], { type: MIME[probe.format] });
      const bitmap = await decodeBitmap(blob);
      const urls: string[] = [];
      const dispose = (): void => {
        for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      };
      try {
        const natural: Size = { w: bitmap.width, h: bitmap.height };
        if (!(natural.w > 0 && natural.h > 0)) throw new Error("The image has no pixels");
        if (natural.w * natural.h > maxPixels) {
          throw new RangeError(`Image is too large (${natural.w} x ${natural.h} px, limit ${maxPixels} pixels)`);
        }
        checkAbort(signal);

        // Display asset: the original file when it is a still, unrotated image of reasonable size;
        // otherwise a re-encoded still (first frame of animations, EXIF orientation baked in).
        const rotated = probe.width !== undefined && probe.width !== natural.w && probe.width === natural.h;
        const displaySize = fitWithin(natural, maxDisplaySide);
        const reencode = probe.animated || rotated || displaySize.w !== natural.w || probe.format === "bmp";
        const displayBlob = reencode ? await encodeStill(ctx.document, bitmap, displaySize) : blob;
        const assetSize = reencode ? displaySize : natural;
        checkAbort(signal);

        const theme = THEMES[ctx.theme === "dark" ? "dark" : "light"];
        const work = fitWithin(natural, workSize);
        const rgba = readPixels(ctx.document, bitmap, work);
        const budget = Math.floor(ctx.maxLayers ?? Number.POSITIVE_INFINITY);
        // One layer for the final image; the rest is split between strokes and tiles.
        const room = budget - 1;
        const strokeCap = Math.min(maxStrokes, Math.floor(room * 0.4));
        const tileCap = Math.min(maxTiles, room - strokeCap);
        const analyzeOpts: AnalyzeOptions = {
          maxStrokes: strokeCap,
          minStrokeLength,
          epsilon,
          maxTiles: tileCap,
          minTile,
          backgroundLuma: theme.luma,
        };
        // Analysed even when only the final image fits, so the strokes left out can be reported.
        const { analysis, mode } = await analyzePixels(rgba, work.w, work.h, analyzeOpts, {
          worker: useWorker,
          timeoutMs: workerTimeout,
          signal,
        });
        if (tileCap === 0) analysis.tiles = [];
        checkAbort(signal);

        let src: string;
        if (inlineAssets || typeof URL.createObjectURL !== "function") src = await blobToDataUrl(displayBlob);
        else {
          src = URL.createObjectURL(displayBlob);
          urls.push(src);
        }

        const place = placeImage(natural, ctx.width, maxUpscale, maxHeightRatio);
        const layers = buildLayers(analysis, place, { src, natural: assetSize }, theme);
        const blueprint: Blueprint = {
          version: 1,
          source: { type: "image", name: input.name, url: input.url },
          size: place.world,
          background: theme.background,
          scheme: ctx.theme === "dark" ? "dark" : "light",
          icon: src,
          layers,
        };
        const sketch = layers.filter((l) => l.meta?.sketch === true).length;
        const tiles = layers.length - sketch - 1;
        // Diagnostics for tools; the final full-image layer always shows every pixel, so nothing is lost.
        const finalLayer = layers[layers.length - 1];
        if (finalLayer) {
          finalLayer.meta = {
            ...finalLayer.meta,
            format: probe.format,
            natural,
            animated: probe.animated,
            analysis: mode,
            sketch,
            tiles,
            strokeCandidates: analysis.strokeCandidates,
          };
        }
        if (input.name) blueprint.source.title = input.name;
        // The host's layer budget cut the sketch or coarsened the tiles; the final image still shows everything.
        const missingStrokes = Math.max(0, Math.min(analysis.strokeCandidates, maxStrokes) - analysis.strokes.length);
        const coarser = tileCap < maxTiles && analysis.tiles.length >= tileCap;
        if (missingStrokes > 0 || coarser) {
          blueprint.truncated = { reason: `layer limit of ${budget} reached`, dropped: missingStrokes };
        }
        return { blueprint, dispose };
      } catch (error) {
        dispose();
        throw error;
      } finally {
        bitmap.close();
      }
    },
  };
}

/** The image adapter with default settings. */
export const imageAdapter: Adapter = createImageAdapter();
