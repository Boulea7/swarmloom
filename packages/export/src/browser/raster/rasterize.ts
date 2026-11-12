import type { ShadowWatch } from "../../render/live";
import { FontFaceCache, type FontWatch } from "./fonts";
import { networkGate, ResourceCache, type ResourcePolicy } from "./resources";
import { type CanvasOverlay, type FrameSnapshot, type SnapshotStats, snapshotFrame } from "./snapshot";
import { readBaseline, type StyleBaseline } from "./styles";

/** What {@link FrameRasterizer} reads and where it reports. */
export interface RasterizerOptions {
  /** Document of the export frame (the render page). */
  document: Document;
  width: number;
  height: number;
  shadows: ShadowWatch;
  fonts: FontWatch;
  /** Fetches resources to embed. Default the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * What may be fetched to embed, as the frame's network policy allows it to load: "https" (the
   * default) or "none". The page's own origin, data: and blob: URLs are always allowed.
   */
  network?: ResourcePolicy;
  onWarning?: (message: string) => void;
}

/** Waits for an image to decode; falls back to the load event where `decode()` is missing. */
async function decoded(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === "function") return img.decode();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("the frame image could not be decoded"));
  });
}

/** False when the canvas is tainted by another origin: drawing it would taint the target too. */
function readable(canvas: HTMLCanvasElement): boolean {
  try {
    const probe = new OffscreenCanvas(1, 1).getContext("2d");
    probe?.drawImage(canvas, 0, 0, 1, 1);
    probe?.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

/** Draws an overlay canvas over the snapshot image, inside its clip, scaled like the image. */
function drawOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  overlay: CanvasOverlay,
  sx: number,
  sy: number,
): void {
  const { canvas, clip } = overlay;
  if (clip.right <= clip.left || clip.bottom <= clip.top || !readable(canvas)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.left * sx, clip.top * sy, (clip.right - clip.left) * sx, (clip.bottom - clip.top) * sy);
  ctx.clip();
  ctx.drawImage(canvas, overlay.x * sx, overlay.y * sy, overlay.width * sx, overlay.height * sy);
  ctx.restore();
}

/**
 * Draws the export frame without a screenshot: each capture serialises the frame document into an
 * SVG image ({@link snapshotFrame}) and draws it into a 2D context. Nothing depends on wall time,
 * so the same document state always gives the same pixels in the same browser.
 */
export class FrameRasterizer {
  readonly #o: RasterizerOptions;
  readonly #resources: ResourceCache;
  readonly #faces: FontFaceCache;
  #baseline: StyleBaseline | null = null;
  /** The last font rules drawn and their URI encoding, kept while the next frames use the same. */
  #fontUri = { css: "", uri: "" };

  constructor(options: RasterizerOptions) {
    this.#o = options;
    this.#resources = new ResourceCache(
      options.fetch ?? globalThis.fetch.bind(globalThis),
      (message) => options.onWarning?.(message),
      networkGate(options.network ?? "https", options.document.baseURI),
    );
    this.#faces = new FontFaceCache((url) => this.#resources.font(url));
  }

  /** Serialises the current frame (exposed for diagnostics and tests). */
  async snapshot(signal?: AbortSignal): Promise<FrameSnapshot> {
    const { document, width, height, shadows, fonts } = this.#o;
    this.#baseline ??= readBaseline(document);
    return snapshotFrame(
      {
        document,
        width,
        height,
        shadowRootOf: () => null,
        shadowRoots: () => shadows.roots(),
        faces: () => fonts.faces(),
      },
      this.#baseline,
      this.#resources,
      this.#faces,
      signal,
    );
  }

  /**
   * Draws the current frame into `ctx` at its origin, scaled to `ctx.canvas`, over white.
   *
   * @throws The signal's reason when it aborts while the snapshot walk pauses.
   */
  async draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    signal?: AbortSignal,
  ): Promise<SnapshotStats> {
    const {
      parts: [head, fonts, tail],
      stats,
      overlays,
    } = await this.snapshot(signal);
    // Fonts are often megabytes and rarely change between frames: they are encoded once.
    if (fonts !== this.#fontUri.css) this.#fontUri = { css: fonts, uri: encodeURIComponent(fonts) };
    const img = new Image();
    // A data URL, not a blob URL: Chromium taints canvases with blob-URL SVG images that hold a
    // foreignObject, and a tainted canvas cannot be read back for hashing and encoding.
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(head)}${this.#fontUri.uri}${encodeURIComponent(tail)}`;
    await decoded(img);
    const { width, height } = ctx.canvas;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    for (const overlay of overlays) drawOverlay(ctx, overlay, width / this.#o.width, height / this.#o.height);
    return stats;
  }
}
