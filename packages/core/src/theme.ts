import type { ResolvedTheme, ResolveThemeFn } from "./internal";
import type { ThemeSpec } from "./types";

/**
 * SwarmLoom brand constants (contracts/brand.md). Original values; not taken from any other product.
 * The cursor palette order matters: agents cycle through it.
 */
export const BRAND = {
  /** Loom Indigo. */
  primary: "#5B5BF7",
  /** Guides, rulers and measurements. */
  accent: "#FF4F7B",
  /** Selection outlines and size badges. */
  select: "#5B5BF7",
  ink: "#0B0B12",
  paper: "#FAFAFC",
  lineLight: "rgba(11,11,18,.12)",
  lineDark: "rgba(255,255,255,.14)",
  palette: [
    "#5B5BF7",
    "#FF6B5B",
    "#14B8A6",
    "#F5A524",
    "#D946EF",
    "#3BA7F5",
    "#84CC16",
    "#9B5CF6",
    "#F43F5E",
    "#0EA5E9",
    "#22C55E",
    "#FB923C",
  ],
} as const;

/** sRGB colour with channels 0..255 and alpha 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Readonly<Record<string, Rgba>> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  whitesmoke: { r: 245, g: 245, b: 245, a: 1 },
  ghostwhite: { r: 248, g: 248, b: 255, a: 1 },
  snow: { r: 255, g: 250, b: 250, a: 1 },
  ivory: { r: 255, g: 255, b: 240, a: 1 },
  beige: { r: 245, g: 245, b: 220, a: 1 },
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Parses a CSS number or percentage; `pctOf` is the value 100% maps to. */
function channel(token: string, pctOf: number): number {
  const t = token.trim();
  if (t === "none") return 0;
  const v = Number.parseFloat(t);
  if (!Number.isFinite(v)) return Number.NaN;
  return t.endsWith("%") ? (v / 100) * pctOf : v;
}

function hue(token: string): number {
  const t = token.trim().toLowerCase();
  const v = Number.parseFloat(t);
  if (!Number.isFinite(v)) return Number.NaN;
  if (t.endsWith("turn")) return v * 360;
  if (t.endsWith("grad")) return v * 0.9;
  if (t.endsWith("rad")) return (v * 180) / Math.PI;
  return v;
}

/** Splits the inside of rgb()/hsl() in either comma or space/slash syntax into [c1, c2, c3, alpha?]. */
function args(inner: string): string[] {
  const [main = "", alpha] = inner.split("/");
  const parts = main.includes(",") ? main.split(",") : main.trim().split(/\s+/);
  if (alpha !== undefined) parts.push(alpha);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const f = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

/**
 * Parses the CSS colour syntaxes snapshots produce: hex (#rgb, #rgba, #rrggbb, #rrggbbaa),
 * rgb()/rgba() and hsl()/hsla() in comma or space syntax, and a small set of named colours.
 * Returns null for anything else (modern colour spaces, currentColor, var(), gradients).
 */
export function parseColor(input: string): Rgba | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (s.length === 0 || s.length > 200) return null;
  const named = NAMED[s];
  if (named) return { ...named };
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const d = [...hex].map((c) => Number.parseInt(c + c, 16));
      return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: hex.length === 4 ? (d[3] ?? 255) / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const kind = fn[1] ?? "";
  const parts = args(fn[2] ?? "");
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts[3] === undefined ? 1 : clamp(channel(parts[3], 1), 0, 1);
  let rgb: [number, number, number];
  if (kind.startsWith("rgb")) {
    rgb = [channel(parts[0] ?? "", 255), channel(parts[1] ?? "", 255), channel(parts[2] ?? "", 255)];
  } else {
    // Saturation and lightness are percentages ("50%"); bare numbers are read on the same 0..100 scale.
    const sat = channel(parts[1] ?? "", 100);
    const lig = channel(parts[2] ?? "", 100);
    rgb = hslToRgb(hue(parts[0] ?? ""), sat / 100, lig / 100);
  }
  if (!rgb.every(Number.isFinite) || !Number.isFinite(alpha)) return null;
  return { r: clamp(rgb[0], 0, 255), g: clamp(rgb[1], 0, 255), b: clamp(rgb[2], 0, 255), a: alpha };
}

/** WCAG 2 relative luminance of an sRGB colour (alpha ignored), 0 (black) .. 1 (white). */
export function relativeLuminance(c: Rgba): number {
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2 contrast ratio between two opaque colours, 1..21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Text colour for labels on a `fill` colour: white (brand rule) unless that falls below 3:1 contrast,
 * then ink. Unparseable colours get white.
 */
export function inkOn(fill: string): string {
  const c = parseColor(fill);
  if (!c) return "#ffffff";
  return contrastRatio(c, WHITE) >= 3 ? "#ffffff" : BRAND.ink;
}

const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)|\b[a-z]+\b/gi;

/**
 * Alpha-weighted mean luminance of every colour found in a CSS background value
 * (a colour or a gradient). Returns null when the background is unknown or mostly transparent.
 */
export function backgroundLuminance(background: string): number | null {
  if (typeof background !== "string" || background.length > 4000) return null;
  let sum = 0;
  let weight = 0;
  let count = 0;
  for (const m of background.matchAll(COLOR_TOKEN)) {
    const c = parseColor(m[0]);
    if (!c) continue;
    count++;
    sum += relativeLuminance(c) * c.a;
    weight += c.a;
  }
  if (count === 0 || weight / count < 0.5) return null;
  return sum / weight;
}

/** Luminance below which white text contrasts better than black text (equal-contrast point). */
const DARK_LUMINANCE = 0.179;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isUsableColor(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return false;
  // Checked first: some DOM shims answer CSS.supports() loosely.
  if (value.startsWith("#")) return HEX_COLOR.test(value);
  const css = (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS;
  if (typeof css?.supports === "function") return css.supports("color", value);
  return parseColor(value) !== null;
}

function contentScheme(blueprint: Parameters<ResolveThemeFn>[1], prefersDark: boolean): ResolvedTheme["scheme"] {
  if (blueprint.scheme === "light" || blueprint.scheme === "dark") return blueprint.scheme;
  const lum = backgroundLuminance(blueprint.background);
  if (lum !== null) return lum < DARK_LUMINANCE ? "dark" : "light";
  return prefersDark ? "dark" : "light";
}

/**
 * Resolves the player `theme` option into concrete colours.
 *
 * - palette / accent / select: ThemeSpec overrides when they are valid CSS colours, else the brand values;
 * - chrome: forced by `"light"` / `"dark"` (or ThemeSpec.chrome), otherwise follows `prefersDark`;
 * - scheme: Blueprint.scheme, else the luminance of Blueprint.background, else `prefersDark`.
 */
export const resolveTheme: ResolveThemeFn = (theme, blueprint, prefersDark) => {
  const spec: ThemeSpec = typeof theme === "object" && theme !== null ? theme : {};
  const palette = Array.isArray(spec.palette) ? spec.palette.filter(isUsableColor).slice(0, 64) : [];
  let chrome: ResolvedTheme["chrome"] = prefersDark ? "dark" : "light";
  if (theme === "light" || theme === "dark") chrome = theme;
  else if (spec.chrome === "light" || spec.chrome === "dark") chrome = spec.chrome;
  return {
    palette: palette.length > 0 ? palette : [...BRAND.palette],
    accent: isUsableColor(spec.accent) ? spec.accent : BRAND.accent,
    select: isUsableColor(spec.select) ? spec.select : BRAND.select,
    chrome,
    scheme: contentScheme(blueprint, prefersDark),
  };
};
