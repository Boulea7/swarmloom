/**
 * SGR (Select Graphic Rendition, `ESC [ ... m`) state: colours and text attributes.
 *
 * Colours are packed numbers so cells can share immutable attribute objects:
 *  - `DEFAULT_COLOR` (-1): the theme's default foreground/background,
 *  - 0..255: palette index (0..15 from the theme, 16..255 xterm extension),
 *  - `RGB_FLAG | 0xRRGGBB`: truecolor.
 */

import { rgbHex, type TerminalTheme, xterm256 } from "./palette";

export const DEFAULT_COLOR = -1;
export const RGB_FLAG = 0x1000000;

export const BOLD = 1;
export const DIM = 2;
export const ITALIC = 4;
export const UNDERLINE = 8;
export const INVERSE = 16;
export const STRIKE = 32;
export const HIDDEN = 64;

/** Immutable text attributes. Equal attributes are not guaranteed to be the same object. */
export interface Attrs {
  readonly fg: number;
  readonly bg: number;
  /** Bit set of BOLD, DIM, ITALIC, UNDERLINE, INVERSE, STRIKE, HIDDEN. */
  readonly flags: number;
}

/** Default attributes: theme colours, no styling. */
export const PLAIN: Attrs = Object.freeze({ fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, flags: 0 });

/** Most parameters a single SGR sequence may carry; longer ones are cut (malicious input guard). */
const MAX_PARAMS = 64;

/**
 * Splits a CSI parameter string into groups: `;` separates parameters, `:` separates the
 * sub-parameters of one (ITU T.416 colour form). Empty fields become -1.
 */
export function parseParams(params: string): number[][] {
  const groups: number[][] = [];
  if (params === "") return groups;
  for (const part of params.split(";", MAX_PARAMS)) {
    groups.push(
      part.split(":", 8).map((s) => {
        if (s === "") return -1;
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) && n >= 0 ? Math.min(n, 65535) : -1;
      }),
    );
  }
  return groups;
}

function paletteIndex(n: number | undefined): number | undefined {
  return n !== undefined && n >= 0 && n <= 255 ? n : undefined;
}

function truecolor(r: number | undefined, g: number | undefined, b: number | undefined): number | undefined {
  const ok = (v: number | undefined): v is number => v !== undefined && v >= 0 && v <= 255;
  return ok(r) && ok(g) && ok(b) ? RGB_FLAG | (r << 16) | (g << 8) | b : undefined;
}

/**
 * Reads an extended colour (38/48/58) starting at `groups[i]`. Returns the colour (or undefined
 * when malformed) and how many extra groups the semicolon form consumed.
 */
function extendedColor(groups: readonly number[][], i: number): { color: number | undefined; skip: number } {
  const g = groups[i] as number[];
  if (g.length > 1) {
    // Colon form: 38:5:n, 38:2:r:g:b or 38:2:colorspace:r:g:b.
    if (g[1] === 5) return { color: paletteIndex(g[2]), skip: 0 };
    if (g[1] === 2) {
      const color = g.length >= 6 ? truecolor(g[3], g[4], g[5]) : truecolor(g[2], g[3], g[4]);
      return { color, skip: 0 };
    }
    return { color: undefined, skip: 0 };
  }
  const mode = groups[i + 1]?.[0];
  if (mode === 5) return { color: paletteIndex(groups[i + 2]?.[0]), skip: 2 };
  if (mode === 2) {
    return { color: truecolor(groups[i + 2]?.[0], groups[i + 3]?.[0], groups[i + 4]?.[0]), skip: 4 };
  }
  // Unknown or missing mode: xterm drops the rest of the sequence.
  return { color: undefined, skip: groups.length };
}

/**
 * Applies an SGR parameter string to `attrs`. Returns `attrs` itself when nothing changed, so
 * runs of equally styled cells keep sharing one object.
 */
export function applySgr(attrs: Attrs, params: string): Attrs {
  const groups = parseParams(params);
  if (groups.length === 0) groups.push([0]);
  let { fg, bg, flags } = attrs;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i] as number[];
    const code = Math.max(0, g[0] as number);
    if (code === 0) {
      fg = DEFAULT_COLOR;
      bg = DEFAULT_COLOR;
      flags = 0;
    } else if (code === 1) flags |= BOLD;
    else if (code === 2) flags |= DIM;
    else if (code === 3) flags |= ITALIC;
    else if (code === 4) flags = g[1] === 0 ? flags & ~UNDERLINE : flags | UNDERLINE;
    else if (code === 7) flags |= INVERSE;
    else if (code === 8) flags |= HIDDEN;
    else if (code === 9) flags |= STRIKE;
    else if (code === 21) flags |= UNDERLINE;
    else if (code === 22) flags &= ~(BOLD | DIM);
    else if (code === 23) flags &= ~ITALIC;
    else if (code === 24) flags &= ~UNDERLINE;
    else if (code === 27) flags &= ~INVERSE;
    else if (code === 28) flags &= ~HIDDEN;
    else if (code === 29) flags &= ~STRIKE;
    else if (code >= 30 && code <= 37) fg = code - 30;
    else if (code === 39) fg = DEFAULT_COLOR;
    else if (code >= 40 && code <= 47) bg = code - 40;
    else if (code === 49) bg = DEFAULT_COLOR;
    else if (code >= 90 && code <= 97) fg = code - 90 + 8;
    else if (code >= 100 && code <= 107) bg = code - 100 + 8;
    else if (code === 38 || code === 48 || code === 58) {
      const { color, skip } = extendedColor(groups, i);
      i += skip;
      if (color !== undefined && code === 38) fg = color;
      else if (color !== undefined && code === 48) bg = color;
      // 58 (underline colour) is parsed for its length and otherwise ignored.
    }
    // Blink (5, 6, 25), fonts (10-20), overline (53, 55) and others are ignored.
  }
  if (fg === attrs.fg && bg === attrs.bg && flags === attrs.flags) return attrs;
  return Object.freeze({ fg, bg, flags });
}

/** CSS colour of a packed colour, or null for the theme default. */
export function colorCss(color: number, theme: TerminalTheme): string | null {
  if (color === DEFAULT_COLOR) return null;
  if (color >= RGB_FLAG) return rgbHex(color);
  if (color < 16) return theme.palette[color] ?? null;
  const rgb = xterm256(color);
  return rgb < 0 ? null : rgbHex(rgb);
}

/** Inline CSS for `attrs` relative to a container already painted with the theme's fg (and bg). */
export function attrsCss(attrs: Attrs, theme: TerminalTheme): string {
  if (attrs.fg === DEFAULT_COLOR && attrs.bg === DEFAULT_COLOR && attrs.flags === 0) return "";
  let fg = colorCss(attrs.fg, theme);
  let bg = colorCss(attrs.bg, theme);
  if (attrs.flags & INVERSE) {
    const f = fg ?? theme.fg;
    fg = bg ?? theme.bg;
    bg = f;
  }
  const out: string[] = [];
  if (attrs.flags & HIDDEN) out.push("color:transparent");
  else if (fg) out.push(`color:${fg}`);
  if (bg) out.push(`background-color:${bg}`);
  if (attrs.flags & BOLD) out.push("font-weight:700");
  if (attrs.flags & ITALIC) out.push("font-style:italic");
  const deco: string[] = [];
  if (attrs.flags & UNDERLINE) deco.push("underline");
  if (attrs.flags & STRIKE) deco.push("line-through");
  if (deco.length > 0) out.push(`text-decoration:${deco.join(" ")}`);
  if (attrs.flags & DIM) out.push("opacity:0.62");
  return out.join(";");
}
