/**
 * SwarmLoom mark (site rendition): the shuttle dart on an indigo tile, crossing two pale warp
 * threads and one coral weft. The brand zone owns the canonical files in assets/brand/; this inline
 * copy keeps the nav free of extra requests.
 */

import { CURSOR_PATH } from "./cursor";

const DART = "translate(4.4 4.4) scale(.98)";

function markBody(): string {
  return (
    '<rect width="32" height="32" rx="8.5" fill="#5B5BF7"/>' +
    '<path d="M11 4V28M21 4V28" stroke="#fff" stroke-opacity=".32" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M5 21.6C11 19.6 20 23.4 27 20.8" stroke="#FF6B5B" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    `<path d="${CURSOR_PATH}" transform="${DART}" fill="#fff"/>`
  );
}

/** Inline mark, 32x32 viewBox. Decorative: the wordmark next to it carries the name. */
export function logoMark(size = 28): string {
  return `<svg class="logo-mark" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">${markBody()}</svg>`;
}

/** Renders the mark at a given size. */
export type MarkRenderer = (size?: number) => string;

/**
 * The brand zone's logo files (light and dark tiles, swapped with the colour scheme) when the build
 * ships them, otherwise the inline mark.
 */
export function markRenderer(files: { light: string; dark: string } | null): MarkRenderer {
  if (!files) return logoMark;
  return (size = 28) =>
    `<picture class="logo-mark"><source media="(prefers-color-scheme: dark)" srcset="${files.dark}">` +
    `<img src="${files.light}" width="${size}" height="${size}" alt="" decoding="async"></picture>`;
}

/** Standalone favicon SVG. Used when the brand assets are absent from the build. */
export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${markBody()}</svg>`;
}
