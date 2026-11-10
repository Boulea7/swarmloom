/** RGB triple with channels in 0..255. */
export type Rgb = [number, number, number];

const HEX6 = /^#([0-9a-f]{6})$/i;

/** Parses #RRGGBB. Throws on anything else so typos in palette data fail loudly. */
export function hexToRgb(hex: string): Rgb {
  const match = HEX6.exec(hex);
  if (!match?.[1]) throw new Error(`expected #RRGGBB colour, got ${hex}`);
  const v = Number.parseInt(match[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Formats an RGB triple as uppercase #RRGGBB. */
export function rgbToHex([r, g, b]: Rgb): string {
  const part = (c: number) =>
    Math.round(Math.min(255, Math.max(0, c)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque colours (1..21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear interpolation of two colours in sRGB space; t = 0 returns `a`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => (ca[i] ?? 0) + ((cb[i] ?? 0) - (ca[i] ?? 0)) * t) as Rgb);
}

/**
 * Darkens `fill` toward `toward` just enough for `text` to reach `minRatio` on it.
 * Returns `fill` untouched when it already passes. Used for name tags on luminous hues.
 */
export function ensureContrast(fill: string, text: string, minRatio: number, toward: string): string {
  if (contrast(fill, text) >= minRatio) return fill;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(fill, toward, mid), text) >= minRatio) hi = mid;
    else lo = mid;
  }
  return mix(fill, toward, hi);
}
