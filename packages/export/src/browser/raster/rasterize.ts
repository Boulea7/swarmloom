import type { ShadowWatch } from "../../render/live";
import type { FontWatch } from "./fonts";
import { ResourceCache } from "./resources";
import { type SnapshotStats, snapshotFrame } from "./snapshot";
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

/**
 * Draws the export frame without a screenshot: each capture serialises the frame document into an
 * SVG image ({@link snapshotFrame}) and draws it into a 2D context. Nothing depends on wall time,
 * so the same document state always gives the same pixels in the same browser.
 */
export class FrameRasterizer {
  readonly #o: RasterizerOptions;
  readonly #resources: ResourceCache;
  #baseline: StyleBaseline | null = null;

  constructor(options: RasterizerOptions) {
    this.#o = options;
    this.#resources = new ResourceCache(options.fetch ?? globalThis.fetch.bind(globalThis), (message) =>
      options.onWarning?.(message),
    );
  }

  /** Serialises the current frame (exposed for diagnostics and tests). */
  async snapshot(): Promise<{ svg: string; stats: SnapshotStats }> {
    const { document, width, height, shadows, fonts } = this.#o;
    this.#baseline ??= readBaseline(document);
    const roots = shadows.roots();
    const byHost = new Map<Element, ShadowRoot>(roots.map((root) => [root.host, root]));
    return snapshotFrame(
      {
        document,
        width,
        height,
        shadowRootOf: (host) => byHost.get(host) ?? null,
        shadowRoots: () => roots,
        faces: () => fonts.faces(),
      },
      this.#baseline,
      this.#resources,
    );
  }

  /** Draws the current frame into `ctx` at its origin, scaled to `ctx.canvas`, over white. */
  async draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): Promise<SnapshotStats> {
    const { svg, stats } = await this.snapshot();
    const img = new Image();
    // A data URL, not a blob URL: Chromium taints canvases with blob-URL SVG images that hold a
    // foreignObject, and a tainted canvas cannot be read back for hashing and encoding.
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await decoded(img);
    const { width, height } = ctx.canvas;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return stats;
  }
}
