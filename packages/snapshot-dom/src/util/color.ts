/**
 * Minimal parser for colours as browsers serialise them in computed styles:
 * `rgb()/rgba()` (legacy and space-separated), `transparent`, and the modern
 * `color()/lab()/lch()/oklab()/oklch()/hsl()/hwb()` functions with an optional `/ alpha`.
 */
export interface ParsedColor {
  /** Alpha 0..1. Unknown syntaxes count as opaque. */
  alpha: number;
  /** Approximate relative luminance 0..1, or null when the colour space is not understood. */
  luminance: number | null;
}

const FN = /^([a-z-]+)\((.*)\)$/i;

function parseComponent(token: string, scale: number): number {
  const t = token.trim();
  if (t.endsWith("%")) return (Number.parseFloat(t) / 100) * scale;
  if (t === "none") return 0;
  return Number.parseFloat(t);
}

function channel(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour with channels 0..1. */
export function srgbLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function parseColor(value: string): ParsedColor {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "transparent") return { alpha: 0, luminance: null };
  if (v === "currentcolor") return { alpha: 1, luminance: null };
  const m = FN.exec(v);
  if (!m) return { alpha: 1, luminance: null };
  const name = m[1] as string;
  const body = m[2] as string;
  let main = body;
  let alpha = 1;
  const slash = body.lastIndexOf("/");
  if (slash >= 0) {
    main = body.slice(0, slash);
    alpha = parseComponent(body.slice(slash + 1), 1);
  }
  const parts = main
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if ((name === "rgba" || name === "hsla") && parts.length === 4 && slash < 0) {
    alpha = parseComponent(parts[3] as string, 1);
  }
  if (!Number.isFinite(alpha)) alpha = 1;
  alpha = Math.min(1, Math.max(0, alpha));
  let luminance: number | null = null;
  if ((name === "rgb" || name === "rgba") && parts.length >= 3) {
    const [r, g, b] = parts.slice(0, 3).map((p) => parseComponent(p, 255) / 255) as [number, number, number];
    luminance = srgbLuminance(r, g, b);
  } else if (name === "color" && parts.length >= 4 && (parts[0] === "srgb" || parts[0] === "display-p3")) {
    const [r, g, b] = parts.slice(1, 4).map((p) => parseComponent(p, 1)) as [number, number, number];
    luminance = srgbLuminance(r, g, b);
  } else if ((name === "oklab" || name === "oklch") && parts.length >= 1) {
    const l = parseComponent(parts[0] as string, 1);
    luminance = l ** 3;
  } else if ((name === "lab" || name === "lch") && parts.length >= 1) {
    const l = parseComponent(parts[0] as string, 100) / 100;
    luminance = l > 0.08 ? ((l + 0.16) / 1.16) ** 3 : l / 9.033;
  }
  if (luminance !== null && !Number.isFinite(luminance)) luminance = null;
  return { alpha, luminance };
}

export function alphaOf(value: string): number {
  return parseColor(value).alpha;
}

/** Computed colours repeat a lot within a page; their visibility is memoised (bounded). */
const visibleCache = new Map<string, boolean>();
const VISIBLE_CACHE_MAX = 1024;

/** True when a colour paints anything noticeable (alpha above 1%). */
export function isVisibleColor(value: string): boolean {
  const cached = visibleCache.get(value);
  if (cached !== undefined) return cached;
  const visible = alphaOf(value) > 0.01;
  if (visibleCache.size >= VISIBLE_CACHE_MAX) visibleCache.clear();
  visibleCache.set(value, visible);
  return visible;
}
