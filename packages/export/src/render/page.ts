import type { AdapterContext } from "@swarmloom/core";
import { createPlayer } from "@swarmloom/core";
import { type FormatEntry, formats, load } from "@swarmloom/formats";
import { renderAudioWav } from "../audio";
import { createRenderApi } from "./api";
import { LIVE_LOOP_PHASE } from "./live";
import type { RenderApi, TerminalFont } from "./protocol";

/**
 * The formats registry with the render page's go-live settings: HTML documents keep their live page
 * (laid out at the frame's height, so it lines up with the woven one, with loops frozen at the phase
 * go live freezes the ones it finds running at); SVG SMIL replays and Lottie
 * players stay on player time after go live, since the export clock keeps ticking. With
 * `terminalFont: "fill"` terminal recordings grow their font to fill the frame.
 */
export function renderFormats(height: number, terminalFont: TerminalFont = "fit"): FormatEntry[] {
  return formats.map((entry): FormatEntry => {
    if (entry.id === "terminal" && terminalFont === "fill") {
      return {
        ...entry,
        loader: () =>
          import("@swarmloom/adapter-terminal").then((m) =>
            m.createTerminalAdapter({ fill: true, viewportHeight: height }),
          ),
      };
    }
    if (entry.id === "html") {
      return {
        ...entry,
        loader: () =>
          import("@swarmloom/adapter-html").then((m) =>
            m.createHtmlAdapter({ keepLive: true, viewportHeight: height, infinitePhase: LIVE_LOOP_PHASE }),
          ),
      };
    }
    if (entry.id === "svg") {
      return {
        ...entry,
        loader: () => import("@swarmloom/adapter-svg").then((m) => m.createSvgAdapter({ liveClock: "player" })),
      };
    }
    if (entry.id === "lottie") {
      return {
        ...entry,
        loader: () => import("@swarmloom/adapter-lottie").then((m) => m.createLottieAdapter({ liveClock: "player" })),
      };
    }
    return entry;
  });
}

/** Options of {@link createPageRenderApi}. */
export interface PageRenderOptions {
  /**
   * What document adapters may fetch (`ctx.network`, read by the html and markdown adapters):
   * "https" images and fonts, or "none". Unset leaves the adapters' default; the CLI filters
   * requests itself.
   */
  network?: "https" | "none";
  /** Wait for the page's next animation frame or two after init() and each step(); see `RenderDeps.awaitPaint`. */
  awaitPaint?: boolean;
}

/**
 * The render page's `window.__swarmloom` for the current window: every registered format with the
 * go-live settings above, core's player and the offline WAV renderer. Shared by the CLI's render
 * page and the frame Studio exports in.
 */
export function createPageRenderApi(options: PageRenderOptions = {}): RenderApi {
  const { network, awaitPaint = false } = options;
  return createRenderApi({
    awaitPaint,
    load: (input, ctx, { format, height, terminalFont }) => {
      const context: AdapterContext = network ? ({ ...ctx, network } as AdapterContext) : ctx;
      return load(input, context, { format, registry: renderFormats(height, terminalFont) });
    },
    createPlayer,
    renderAudioWav,
  });
}
