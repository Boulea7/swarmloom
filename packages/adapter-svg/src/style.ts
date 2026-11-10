/**
 * Computed-style helpers shared by the converter, the defs builder and text conversion.
 */

/** Computed style through the element's own window (the sandbox may live in another document). */
export function computedStyle(el: Element): CSSStyleDeclaration {
  const view = el.ownerDocument.defaultView;
  if (!view) throw new Error("The SVG adapter needs a document with a window to measure layout");
  return view.getComputedStyle(el);
}

/**
 * Properties inlined onto raw clones (content copied verbatim into defs or snapshots), with the
 * computed value that means "initial" in Chromium/WebKit/Gecko so it can be skipped.
 * `font-size` and `font-family` are always written because their initial values depend on context.
 */
export const INLINE_PROPS: ReadonlyArray<readonly [string, string | null]> = [
  ["fill", "rgb(0, 0, 0)"],
  ["fill-opacity", "1"],
  ["fill-rule", "nonzero"],
  ["stroke", "none"],
  ["stroke-width", "1px"],
  ["stroke-opacity", "1"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-miterlimit", "4"],
  ["stroke-dasharray", "none"],
  ["stroke-dashoffset", "0px"],
  ["opacity", "1"],
  ["clip-rule", "nonzero"],
  ["clip-path", "none"],
  ["mask", "none"],
  ["filter", "none"],
  ["marker-start", "none"],
  ["marker-mid", "none"],
  ["marker-end", "none"],
  ["stop-color", "rgb(0, 0, 0)"],
  ["stop-opacity", "1"],
  ["flood-color", "rgb(0, 0, 0)"],
  ["flood-opacity", "1"],
  ["lighting-color", "rgb(255, 255, 255)"],
  ["color-interpolation-filters", "linearrgb"],
  ["mask-type", "luminance"],
  ["font-family", null],
  ["font-size", null],
  ["font-weight", "400"],
  ["font-style", "normal"],
  ["font-variant", "normal"],
  ["text-anchor", "start"],
  ["dominant-baseline", "auto"],
  ["baseline-shift", "0px"],
  ["letter-spacing", "normal"],
  ["word-spacing", "0px"],
  ["text-decoration-line", "none"],
  ["white-space", "normal"],
  ["writing-mode", "horizontal-tb"],
  ["visibility", "visible"],
  ["paint-order", "normal"],
  ["mix-blend-mode", "normal"],
  ["vector-effect", "none"],
  ["shape-rendering", "auto"],
];

function safeDecode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Fragment ids referenced by `url(#id)` in a computed value, in order. */
export function urlIds(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/g)) {
    const target = m[2] ?? "";
    const hash = target.lastIndexOf("#");
    if (hash >= 0) out.push(safeDecode(target.slice(hash + 1)));
  }
  return out;
}

/** Replaces every `url(...#id)` in `value` with `url(#mapped)`, or `none` when unmapped. */
export function rewriteUrls(value: string, map: (id: string) => string | null): string {
  return value.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/g, (_m, _q: string, target: string) => {
    const hash = target.lastIndexOf("#");
    const mapped = hash >= 0 ? map(safeDecode(target.slice(hash + 1))) : null;
    return mapped ? `url(#${mapped})` : "none";
  });
}

export interface ParsedPaint {
  /** Referenced paint server id, if any. */
  ref?: string;
  /** Colour, `none`, or the fallback after a url reference. */
  colour: string;
}

/** Splits a computed `fill`/`stroke` value into a reference and a colour/fallback. */
export function parsePaint(value: string): ParsedPaint {
  const v = value.trim();
  if (!v.startsWith("url(")) return { colour: v || "none" };
  const close = v.indexOf(")");
  const ref = urlIds(v.slice(0, close + 1))[0];
  const fallback = v.slice(close + 1).trim();
  return ref ? { ref, colour: fallback || "none" } : { colour: fallback || "none" };
}

/** Parses `rgb()/rgba()` (comma or space syntax) into 0..255 channels and 0..1 alpha. */
export function parseRgb(value: string): [number, number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (!m) return null;
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

/** Multiplies the alpha of a computed colour, returning `rgba()`; other syntaxes pass through. */
export function withAlpha(colour: string, alpha: number): string {
  if (alpha >= 1) return colour;
  const rgb = parseRgb(colour);
  if (!rgb) return colour;
  const a = Math.round(rgb[3] * alpha * 1000) / 1000;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

/** Relative luminance (0..1) of a computed colour, or null when it cannot be parsed. */
export function luminance(colour: string): number | null {
  const rgb = parseRgb(colour);
  if (!rgb) return null;
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function isTransparent(colour: string): boolean {
  const v = colour.trim().toLowerCase();
  if (v === "transparent" || v === "none" || v === "") return true;
  const rgb = parseRgb(v);
  return rgb !== null && rgb[3] === 0;
}

/** Number from a computed value such as "12px" or "0.5"; `fallback` when not numeric. */
export function num(value: string | null | undefined, fallback = 0): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
