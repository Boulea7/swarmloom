/**
 * Icons from Phosphor (@phosphor-icons/core, MIT), inlined at build time so they cost no requests.
 * This module runs in Node during the build only.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export type IconName =
  | "play"
  | "copy"
  | "check"
  | "arrow-right"
  | "arrow-up-right"
  | "arrow-counter-clockwise"
  | "caret-left"
  | "caret-right"
  | "envelope-simple"
  | "download-simple"
  | "translate";

type Weight = "regular" | "bold" | "fill";

const require = createRequire(import.meta.url);
const cache = new Map<string, string>();

function load(name: IconName, weight: Weight): string {
  const key = `${weight}/${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const file = weight === "regular" ? `${name}.svg` : `${name}-${weight}.svg`;
  // Resolved through the package's "exports" map (./assets/<weight>/*.svg).
  const svg = readFileSync(require.resolve(`@phosphor-icons/core/assets/${weight}/${file}`), "utf8").trim();
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
  if (!inner) throw new Error(`Unexpected icon markup in ${key}`);
  cache.set(key, inner);
  return inner;
}

/**
 * Inline icon markup. Decorative by default (aria-hidden); the surrounding control carries the label.
 * @throws Error when the icon file is missing (fails the build rather than shipping a blank).
 */
export function icon(name: IconName, options: { weight?: Weight; size?: number; className?: string } = {}): string {
  const { weight = "bold", size = 20, className } = options;
  const cls = ["icon", className].filter(Boolean).join(" ");
  return `<svg class="${cls}" viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">${load(name, weight)}</svg>`;
}
