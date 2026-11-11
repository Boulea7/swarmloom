/**
 * Brand colours (contracts/brand.md). Cursor colours are the only saturated colours on the page.
 */

/** Cursor palette, cycled across agents; order matters. */
export const CURSOR_PALETTE = [
  "#5B5BF7", // indigo
  "#FF6B5B", // coral
  "#14B8A6", // teal
  "#F5A524", // amber
  "#D946EF", // orchid
  "#3BA7F5", // sky
  "#84CC16", // lime
  "#9B5CF6", // violet
  "#F43F5E", // rose
  "#0EA5E9", // cyan
  "#22C55E", // green
  "#FB923C", // orange
] as const;

export const INK = "#0B0B12";
export const PAPER = "#FAFAFC";

/** Cursor colour for an agent index (wraps around the palette). */
export function cursorColor(index: number): string {
  const n = CURSOR_PALETTE.length;
  return CURSOR_PALETTE[((index % n) + n) % n] as string;
}

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected #RRGGBB, got ${hex}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio between two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour for a name tag on `background`. The brand asks for white text; light cursor colours
 * (amber, lime, teal...) get ink instead so every tag stays readable.
 */
export function tagTextColor(background: string): string {
  return contrast(PAPER, background) >= contrast(INK, background) ? PAPER : INK;
}
