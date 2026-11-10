/** Straight (non-premultiplied) sRGB colour, channels 0..255, alpha 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX6 = /^[0-9a-f]{6}$/i;
const HEX8 = /^[0-9a-f]{8}$/i;

/** Parses `RRGGBB` (DrawingML) or `AARRGGBB` (SpreadsheetML ARGB). Returns undefined for anything else. */
export function parseHex(value: string | undefined): Rgba | undefined {
  if (!value) return undefined;
  const v = value.trim().replace(/^#/, "");
  if (HEX6.test(v)) {
    return { r: hexByte(v, 0), g: hexByte(v, 2), b: hexByte(v, 4), a: 1 };
  }
  if (HEX8.test(v)) {
    return { r: hexByte(v, 2), g: hexByte(v, 4), b: hexByte(v, 6), a: hexByte(v, 0) / 255 };
  }
  return undefined;
}

function hexByte(v: string, at: number): number {
  return Number.parseInt(v.slice(at, at + 2), 16);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function toHex(n: number): string {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, "0");
}

/** CSS colour string: `#rrggbb` when opaque, `rgba(...)` otherwise. */
export function cssColor(c: Rgba): string {
  if (c.a >= 0.999) return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
  const a = Math.round(clamp(c.a, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/** Relative luminance (WCAG) in 0..1. */
export function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl({ r, g, b }: Rgba): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }: Hsl, a: number): Rgba {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255, a };
}

/** Builds a colour from HSL in 0..1. */
export function hsl(h: number, s: number, l: number): Rgba {
  return fromHsl({ h: ((h % 1) + 1) % 1, s: clamp(s, 0, 1), l: clamp(l, 0, 1) }, 1);
}

/** Mixes towards white: `amount` 1 keeps the colour, 0 gives white (DrawingML `tint`). */
export function tint(c: Rgba, amount: number): Rgba {
  const t = clamp(amount, 0, 1);
  return { r: 255 - (255 - c.r) * t, g: 255 - (255 - c.g) * t, b: 255 - (255 - c.b) * t, a: c.a };
}

/** Mixes towards black: `amount` 1 keeps the colour, 0 gives black (DrawingML `shade`). */
export function shade(c: Rgba, amount: number): Rgba {
  const s = clamp(amount, 0, 1);
  return { r: c.r * s, g: c.g * s, b: c.b * s, a: c.a };
}

/** Scales luminance, then offsets it (DrawingML `lumMod` / `lumOff`, both as fractions). */
export function adjustLuminance(c: Rgba, mod: number, off: number): Rgba {
  const h = toHsl(c);
  return fromHsl({ ...h, l: clamp(h.l * mod + off, 0, 1) }, c.a);
}

/** Scales and offsets saturation (DrawingML `satMod` / `satOff`). */
export function adjustSaturation(c: Rgba, mod: number, off: number): Rgba {
  const h = toHsl(c);
  return fromHsl({ ...h, s: clamp(h.s * mod + off, 0, 1) }, c.a);
}

/**
 * SpreadsheetML tint in -1..1: negative darkens, positive lightens, applied to HSL lightness
 * as described in ECMA-376 Part 1, 18.8.19.
 */
export function sheetTint(c: Rgba, t: number): Rgba {
  if (!t) return c;
  const h = toHsl(c);
  const l = t < 0 ? h.l * (1 + t) : h.l * (1 - t) + t;
  return fromHsl({ ...h, l: clamp(l, 0, 1) }, c.a);
}

/** Common preset colour names (DrawingML `prstClr`, ODF and CSS overlap). */
export const PRESET_COLORS: Readonly<Record<string, string>> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  gray: "808080",
  grey: "808080",
  ltGray: "D3D3D3",
  dkGray: "A9A9A9",
  orange: "FFA500",
  purple: "800080",
  navy: "000080",
  teal: "008080",
  silver: "C0C0C0",
  maroon: "800000",
  olive: "808000",
  lime: "00FF00",
};
