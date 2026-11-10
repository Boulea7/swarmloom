/**
 * Entry of the IIFE/CDN build `dist/swarm-loom.global.js`: registers `<swarm-loom>` and exposes
 * the API as `window.SwarmLoom`. The engine is included; adapters load lazily next to the script.
 *
 * ```html
 * <script src="https://cdn.jsdelivr.net/npm/@swarmloom/element/dist/swarm-loom.global.js"></script>
 * <swarm-loom src="README.md" autoplay controls></swarm-loom>
 * ```
 */

import { configure, define, SwarmLoomElement, TAG_NAME } from "../index";

export { configure, define, SwarmLoomElement, TAG_NAME };

if (globalThis.customElements && !globalThis.customElements.get(TAG_NAME)) define();
