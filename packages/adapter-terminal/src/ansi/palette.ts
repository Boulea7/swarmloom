/**
 * Terminal colours: SwarmLoom's own 16-colour palette (tuned for the dark terminal window) and
 * the standard xterm 256-colour extension (6x6x6 cube plus a 24-step grey ramp).
 */

/** Foreground, background and the 16 ANSI colours as `#rrggbb`. */
export interface TerminalTheme {
  fg: string;
  bg: string;
  /** Exactly 16 entries: black, red, green, yellow, blue, magenta, cyan, white, then the bright set. */
  palette: readonly string[];
}

/** "Loom Ink": the default terminal theme (original colours, not taken from any other terminal). */
export const LOOM_INK: TerminalTheme = Object.freeze({
  fg: "#e6e7ef",
  bg: "#0f1017",
  palette: Object.freeze([
    "#1f2030",
    "#ff5f6d",
    "#3dd68c",
    "#f5c05b",
    "#7b8cff",
    "#d07cf5",
    "#3cc8d8",
    "#c9cbd8",
    "#55586e",
    "#ff8a93",
    "#79e9b0",
    "#ffd98a",
    "#a3b0ff",
    "#e3a6ff",
    "#7fe3ee",
    "#f4f5fa",
  ]),
});

/** "Loom Paper": a light theme for coloured output on white pages (notebook outputs). */
export const LOOM_PAPER: TerminalTheme = Object.freeze({
  fg: "#1d1e2c",
  bg: "#fafafc",
  palette: Object.freeze([
    "#1d1e2c",
    "#c8283c",
    "#1f8a52",
    "#a86a00",
    "#3b47d6",
    "#9a3bc4",
    "#0f7f8f",
    "#7c7f93",
    "#55586e",
    "#e0475a",
    "#2aa86a",
    "#c88a14",
    "#5b5bf7",
    "#b45ad8",
    "#1b9aac",
    "#a6a9ba",
  ]),
});

const HEX = /^#?([0-9a-f]{6})$/i;
const SHORT_HEX = /^#?([0-9a-f]{3})$/i;

/** Normalises `#rgb`/`#rrggbb` (with or without `#`) to lower-case `#rrggbb`; null otherwise. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const long = HEX.exec(v);
  if (long?.[1]) return `#${long[1].toLowerCase()}`;
  const short = SHORT_HEX.exec(v);
  if (short?.[1]) {
    const [r, g, b] = short[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

/**
 * Builds a theme from an asciinema header theme (`{ fg, bg, palette }`, where `palette` is a
 * colon-separated list of 8 or 16 colours). Invalid parts fall back to `base`.
 */
export function themeFrom(raw: unknown, base: TerminalTheme = LOOM_INK): TerminalTheme {
  if (!raw || typeof raw !== "object") return base;
  const t = raw as { fg?: unknown; bg?: unknown; palette?: unknown };
  const fg = normalizeHex(t.fg) ?? base.fg;
  const bg = normalizeHex(t.bg) ?? base.bg;
  let palette = base.palette;
  if (typeof t.palette === "string") {
    const parts = t.palette.split(":").map(normalizeHex);
    if ((parts.length === 8 || parts.length === 16) && parts.every((p) => p !== null)) {
      const full = parts as string[];
      palette = full.length === 16 ? full : [...full, ...full];
    }
  }
  return { fg, bg, palette };
}

const CUBE = [0, 95, 135, 175, 215, 255];

/** RGB (0xRRGGBB) of xterm colour 16..255. Indices 0..15 are theme colours and return -1. */
export function xterm256(index: number): number {
  if (index < 16 || index > 255) return -1;
  if (index >= 232) {
    const v = 8 + (index - 232) * 10;
    return (v << 16) | (v << 8) | v;
  }
  const i = index - 16;
  const r = CUBE[Math.floor(i / 36)] as number;
  const g = CUBE[Math.floor(i / 6) % 6] as number;
  const b = CUBE[i % 6] as number;
  return (r << 16) | (g << 8) | b;
}

/** `#rrggbb` of a packed 0xRRGGBB value. */
export function rgbHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}
