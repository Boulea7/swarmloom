/**
 * Entry of the headless render page (dist/render/index.html + render.js). Installs
 * `window.__swarmloom`; adapters are fetched lazily as separate chunks next to render.js.
 */

import { createPlayer } from "@swarmloom/core";
import { load } from "@swarmloom/formats";
import { renderAudioWav } from "../audio";
import { createRenderApi } from "./api";

window.__swarmloom = createRenderApi({
  load: (input, ctx, options) => load(input, ctx, options),
  createPlayer,
  renderAudioWav,
});
// Drivers may wait for this instead of polling for window.__swarmloom.
document.documentElement.dataset.swarmloom = "ready";
