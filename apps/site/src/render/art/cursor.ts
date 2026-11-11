/**
 * SwarmLoom cursor art (original): a "shuttle dart", symmetric about the diagonal, with a rounded
 * tip, convex flanks and a concave tail notch like the point of a loom shuttle. A light outline and a
 * faint offset shadow keep it legible on any page. Drawn in a 24x24 box, hotspot at {@link CURSOR_TIP}.
 */

import { esc, num } from "../html";
import { tagTextColor } from "./palette";

/** Dart outline in the 24x24 cursor box. */
export const CURSOR_PATH =
  "M4.15 3.27Q10.57 6.18 17.92 10.14Q19.37 10.95 18.06 11.56Q13.32 11.63 11.63 11.63" +
  "Q11.63 13.32 11.56 18.06Q10.95 19.37 10.14 17.92Q6.18 10.57 3.27 4.15Q2.61 2.61 4.15 3.27Z";

/** Hotspot of {@link CURSOR_PATH}. */
export const CURSOR_TIP = { x: 2.9, y: 2.9 } as const;

/** Approximate rendered width of a name tag (11px/600 system UI) for SVG layout. */
export function tagWidth(label: string): number {
  let width = 0;
  for (const ch of label) width += /[　-鿿]/.test(ch) ? 11 : /[A-Z]/.test(ch) ? 7.4 : 6.3;
  return Math.ceil(width + 14);
}

/**
 * Cursor glyph as SVG children, tip at the local origin.
 * @param color Cursor fill.
 * @param label Optional name tag drawn below-right of the tip.
 * @param scale Glyph scale (1 = 24px box).
 */
export function cursorGlyph(color: string, label?: string, scale = 1): string {
  const s = num(scale);
  const shift = `translate(${num(-CURSOR_TIP.x * scale)} ${num(-CURSOR_TIP.y * scale)}) scale(${s})`;
  let out =
    `<g transform="${shift}">` +
    `<path d="${CURSOR_PATH}" transform="translate(.4 .9)" class="cur-shadow"/>` +
    `<path d="${CURSOR_PATH}" class="cur-edge"/>` +
    `<path d="${CURSOR_PATH}" fill="${color}"/>` +
    "</g>";
  if (label) {
    const w = tagWidth(label) * scale;
    const h = 18 * scale;
    const x = 12.5 * scale;
    const y = 14 * scale;
    out +=
      `<g class="cur-tag"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(6 * scale)}" fill="${color}"/>` +
      `<text x="${num(x + 7 * scale)}" y="${num(y + 12.6 * scale)}" font-size="${num(11 * scale)}" fill="${tagTextColor(color)}">${esc(label)}</text></g>`;
  }
  return out;
}

/** Standalone inline SVG of a cursor (24x24), for HTML-positioned cursors. */
export function cursorSvg(color: string, size = 24): string {
  return (
    `<svg class="cur" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<path d="${CURSOR_PATH}" transform="translate(.4 .9)" class="cur-shadow"/>` +
    `<path d="${CURSOR_PATH}" class="cur-edge"/>` +
    `<path d="${CURSOR_PATH}" fill="${color}"/></svg>`
  );
}
