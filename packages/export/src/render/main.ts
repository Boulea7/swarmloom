/**
 * Entry of the headless render page (dist/render/index.html + render.js). Installs
 * `window.__swarmloom`; adapters are fetched lazily as separate chunks next to render.js.
 */

import { createPageRenderApi } from "./page";

window.__swarmloom = createPageRenderApi();
// Drivers may wait for this instead of polling for window.__swarmloom.
document.documentElement.dataset.swarmloom = "ready";
