import type { ShadowWatch } from "../../render/live";
import { FarCache } from "./far";
import { FontFaceCache, type FontWatch } from "./fonts";
import { LONG_PIECE, networkGate, ResourceCache, type ResourcePolicy } from "./resources";
import { type CanvasOverlay, type FarBox, type FrameSnapshot, type SnapshotStats, snapshotFrame } from "./snapshot";
import { renderingUpdate, StillWatch } from "./still";
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
  /**
   * Whether it shows what the engine took at the page's last rendering update for the page as it
   * is: its walk came after a rendering update with nothing changed since the frame before it, and
   * gave the same markup. A frame walked after a change follows the update after the change, but
   * what that update took can change what the next one takes (see {@link FrameRasterizer.draw}).
   */
  final: boolean;
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
  /** Whether the next walk reads again a frame the document still shows, after a rendering update. */
  #again = false;

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
   * What the engine takes at a rendering update from the layout and scroll offsets it sees then
   * (scroll-state container queries, the scroll offsets anchor positions follow, the fallbacks they
   * take) follows a change only at the page's next rendering update, without a mutation or event.
   * So the first frame, and the first after each change, waits for that update before its walk, as
   * the CLI's screenshot comes after it; in a hidden document, which takes none, it walks at once.
   * It holds only until the update after its walk: the next frame then waits for that one if it has
   * not come and walks again, and the frame holds once the walk gives the same markup
   * ({@link DrawnFrame.final}), so a cascade of that state (a stuck header that changes what
   * scrolls) settles too.
   *
   * @throws The signal's reason when it aborts while the snapshot walk pauses.
   */
  async draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    signal?: AbortSignal,
  ): Promise<SnapshotStats> {
    const { width, height } = ctx.canvas;
    const scale = Math.max(width / this.#o.width, height / this.#o.height);
    // A walk after a change, or the first, follows the rendering update after the change. After a
    // frame that changed or was not watched this one most likely walks too, so it waits before the
    // still check: an await between that check and the walk would end the reads they share with
    // the next watch and the far cache (see reads.ts).
    const updated = this.#busy || !this.#last?.watch;
    if (updated) await renderingUpdate(this.#o.document);
    let held = this.#still(scale);
    if (held instanceof Promise) held = await held;
    else if (!held && !updated) await renderingUpdate(this.#o.document);
    const { img, overlays, stats } = held ?? (await this.#capture(scale, signal));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    for (const overlay of overlays) drawOverlay(ctx, overlay, width / this.#o.width, height / this.#o.height);
    return stats;
  }

  /**
   * The last frame, when the document still shows it at this scale; else null, and its watch stops.
   * A promise when the last frame waits for the page's next rendering update ({@link DrawnFrame.final}).
   */
  #still(scale: number): DrawnFrame | null | Promise<DrawnFrame | null> {
    const last = this.#last;
    const watch = last?.watch;
    // Null: nothing changed as far as the watch can tell without the rule text, which a walk reads.
    const same = last && watch && last.scale === scale ? watch.still() : false;
    if (!last || !watch || same === false) return this.#release(last, watch);
    if (same && last.final) return last;
    // Until the page's next rendering update, the engine keeps what the last walk read; a walk
    // after it, with nothing changed, reads what the engine took for the page as it is.
    return watch.rendered().then((rendered) => {
      if (same && !rendered) return last;
      this.#again = rendered;
      return this.#release(last, watch);
    });
  }

  /** Stops the last frame's watch before a walk, and tells whether the next watch reads the rule text. */
  #release(last: DrawnFrame | null, watch: StillWatch | null | undefined): null {
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
    const again = this.#again;
    this.#again = false;
    try {
      const snapshot = await this.snapshot(signal, scale);
      const { parts, stats, overlays, frames } = snapshot;
      const last = this.#last;
      const same = last !== null && sameParts(parts, last.parts);
      let img = last?.img;
      if (!img || !same) {
        img = new Image();
        // A data URL, not a blob URL: Chromium taints canvases with blob-URL SVG images that hold a
        // foreignObject, and a tainted canvas cannot be read back for hashing and encoding.
        img.src = this.#uri(parts);
        await decoded(img);
      }
      const settled = watch.settle(snapshot);
      const final = again && same;
      this.#last = { parts, img, overlays, stats, scale, frames, watch: settled ? watch : null, final };
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
