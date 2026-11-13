import type { ShadowWatch } from "../../render/live";
import { FarCache } from "./far";
import { FontFaceCache, type FontWatch } from "./fonts";
import { LONG_PIECE, networkGate, ResourceCache, type ResourcePolicy } from "./resources";
import { type CanvasOverlay, type FarBox, type FrameSnapshot, type SnapshotStats, snapshotFrame } from "./snapshot";
import { StillWatch } from "./still";
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

/** The last frame drawn: its decoded image and what to draw over it. */
interface DrawnFrame {
  parts: readonly string[];
  img: HTMLImageElement;
  overlays: CanvasOverlay[];
  stats: SnapshotStats;
  /** Device px per CSS px it was serialised for. */
  scale: number;
  /** The documents of the same-origin frames it drew (`FrameSnapshot.frames`). */
  frames: readonly Document[];
  /** Watches the document since its snapshot; null when it may change unseen (see {@link StillWatch}). */
  watch: StillWatch | null;
}

/** Whether two snapshots are made of the same pieces. */
function sameParts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
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
  /**
   * URI encodings of the long parts of the last image (fonts, data URLs of images), by part: the
   * next frames mostly use the same, and encoding megabytes again took tens of milliseconds.
   */
  #encoded = new Map<string, string>();
  #last: DrawnFrame | null = null;
  /** The boxes earlier snapshots wrote away from the viewport, written again while unchanged. */
  readonly #far = new FarCache<FarBox>();
  /** Whether the last frame was walked as the page changed ({@link StillWatch.busy}) or unwatched. */
  #busy = false;
  /** Whether the next watch reads the text of the rules (see {@link FrameRasterizer.draw}). */
  #texts = true;

  constructor(options: RasterizerOptions) {
    this.#o = options;
    this.#resources = new ResourceCache(
      options.fetch ?? globalThis.fetch.bind(globalThis),
      (message) => options.onWarning?.(message),
      networkGate(options.network ?? "https", options.document.baseURI),
    );
    this.#faces = new FontFaceCache((url) => this.#resources.font(url));
  }

  /**
   * Serialises the current frame (exposed for diagnostics and tests), for drawing at `scale`
   * device px per CSS px.
   */
  async snapshot(signal?: AbortSignal, scale = 1): Promise<FrameSnapshot> {
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
        scale,
        far: this.#far,
      },
      this.#baseline,
      this.#resources,
      this.#faces,
      signal,
    );
  }

  /**
   * Draws the current frame into `ctx` at its origin, scaled to `ctx.canvas`, over white. While
   * the document shows what the last snapshot read (no mutation, load, toggle, scroll or focus
   * change since, in it or in the live page it shows, the same text in the rules of their style
   * sheets, the same from each Web Animation, the same size for each box written empty and the
   * same pixels in each canvas drawn into the image; see {@link StillWatch}), the frame skips the
   * snapshot and draws the last image
   * again with the overlays, such as the cursors, over it: an opening that holds the page, an
   * intro whose cursors move over a still stage, or the rest of a still page after going live. A
   * frame whose snapshot comes out the same as the last one's also reuses its decoded image.
   *
   * @throws The signal's reason when it aborts while the snapshot walk pauses.
   */
  async draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    signal?: AbortSignal,
  ): Promise<SnapshotStats> {
    const { width, height } = ctx.canvas;
    const scale = Math.max(width / this.#o.width, height / this.#o.height);
    const { img, overlays, stats } = this.#still(scale) ?? (await this.#capture(scale, signal));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    for (const overlay of overlays) drawOverlay(ctx, overlay, width / this.#o.width, height / this.#o.height);
    return stats;
  }

  /** The last frame, when the document still shows it at this scale; else null, and its watch stops. */
  #still(scale: number): DrawnFrame | null {
    const last = this.#last;
    const watch = last?.watch;
    if (last && watch && last.scale === scale && watch.still()) return last;
    // Two frames in a row that changed or were not watched, as while the stage builds, an animation
    // runs or, after going live, every frame seeks the animations: the next one most likely changes
    // too, so its watch leaves the text of the rules unread.
    const busy = !watch || watch.busy;
    this.#texts = !(busy && this.#busy);
    this.#busy = busy;
    watch?.stop();
    if (last) last.watch = null;
    return null;
  }

  /** Snapshots the frame and decodes its image, unless it is the same as the last one's. */
  async #capture(scale: number, signal?: AbortSignal): Promise<DrawnFrame> {
    const { document, shadows, fonts } = this.#o;
    // Its probe elements would count as a change.
    this.#baseline ??= readBaseline(document);
    const source = { document, shadowRoots: () => shadows.roots(), faces: () => fonts.faces() };
    // The frames the last snapshot left out stay out until the trees around them change.
    const watch = new StillWatch(source, this.#texts, this.#last?.frames ?? null);
    try {
      const snapshot = await this.snapshot(signal, scale);
      const { parts, stats, overlays, frames } = snapshot;
      let img = this.#last?.img;
      if (!img || !sameParts(parts, this.#last?.parts ?? [])) {
        img = new Image();
        // A data URL, not a blob URL: Chromium taints canvases with blob-URL SVG images that hold a
        // foreignObject, and a tainted canvas cannot be read back for hashing and encoding.
        img.src = this.#uri(parts);
        await decoded(img);
      }
      const settled = watch.settle(snapshot);
      this.#last = { parts, img, overlays, stats, scale, frames, watch: settled ? watch : null };
      return this.#last;
    } catch (error) {
      watch.stop();
      throw error;
    }
  }

  /** The image's data URL, with the encodings of long parts the last image had reused. */
  #uri(parts: readonly string[]): string {
    const encoded = new Map<string, string>();
    let uri = "data:image/svg+xml;charset=utf-8,";
    for (const part of parts) {
      if (part.length < LONG_PIECE) {
        uri += encodeURIComponent(part);
        continue;
      }
      const known = encoded.get(part) ?? this.#encoded.get(part) ?? encodeURIComponent(part);
      encoded.set(part, known);
      uri += known;
    }
    this.#encoded = encoded;
    return uri;
  }
}
