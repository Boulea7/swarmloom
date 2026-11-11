/**
 * Entry of the headless render page (dist/render/index.html + render.js). Installs
 * `window.__swarmloom`; adapters are fetched lazily as separate chunks next to render.js.
 */

import { createPlayer } from "@swarmloom/core";
import { type FormatEntry, formats, load } from "@swarmloom/formats";
import { renderAudioWav } from "../audio";
import { createRenderApi } from "./api";

/**
 * The formats registry with the render page's go-live settings: HTML documents keep their live page
 * (laid out at the frame's height, so it lines up with the woven one) and SVG SMIL replays stay on
 * player time after go live, since the export clock keeps ticking.
 */
function renderFormats(height: number): FormatEntry[] {
  return formats.map((entry): FormatEntry => {
    if (entry.id === "html") {
      return {
        ...entry,
        loader: () =>
          import("@swarmloom/adapter-html").then((m) =>
            m.createHtmlAdapter({ keepLive: true, viewportHeight: height }),
          ),
      };
    }
    if (entry.id === "svg") {
      return {
        ...entry,
        loader: () => import("@swarmloom/adapter-svg").then((m) => m.createSvgAdapter({ liveClock: "player" })),
      };
    }
    return entry;
  });
}

window.__swarmloom = createRenderApi({
  load: (input, ctx, { format, height }) => load(input, ctx, { format, registry: renderFormats(height) }),
  createPlayer,
  renderAudioWav,
});
// Drivers may wait for this instead of polling for window.__swarmloom.
document.documentElement.dataset.swarmloom = "ready";
