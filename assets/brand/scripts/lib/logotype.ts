import { LOGOTYPE_GLYPHS, LOGOTYPE_METRICS } from "./glyphs.ts";
import { MARK_GRID, type MarkStyle, markBody } from "./mark.ts";
import { el, n, svgDoc, translatePath } from "./svg.ts";

/** Axis-aligned box. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounds of an absolute M/L/Q/C path, control points included (a safe, slightly generous box). */
export function pathBounds(d: string): Box {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  if (nums.length < 2) throw new Error("path has no coordinates");
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i] ?? 0;
    const y = nums[i + 1] ?? 0;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A glyph placed in document space. */
export interface PlacedGlyph {
  ch: string;
  /** Absolute path data. */
  d: string;
  /** Ink bounds of the glyph. */
  box: Box;
}

/** Lays out the logotype with its baseline at `baseline` and origin at `x`, scaled from the 100-unit em. */
export function placeLogotype(x: number, baseline: number, scale: number): PlacedGlyph[] {
  return LOGOTYPE_GLYPHS.map((g) => {
    const d = translatePath(g.d, x + g.x * scale, baseline, scale);
    return { ch: g.ch, d, box: pathBounds(d) };
  });
}

/** Lockup geometry in logotype units (em 100): mark size, gap and the resulting artboard. */
export const LOCKUP = (() => {
  const mark = 88;
  const gap = 24;
  const cap = LOGOTYPE_METRICS.capHeight;
  const baseline = mark / 2 + cap / 2;
  return { mark, gap, baseline, width: Math.ceil(mark + gap + LOGOTYPE_METRICS.width), height: mark };
})();

/** Horizontal lockup: mark followed by the logotype, vertically centred on the cap height. */
export function wordmarkSvg(style: MarkStyle, ink: string, title = "SwarmLoom"): string {
  const glyphs = placeLogotype(LOCKUP.mark + LOCKUP.gap, LOCKUP.baseline, 1);
  const mark = el("g", { transform: `scale(${n(LOCKUP.mark / MARK_GRID)})` }, markBody(style));
  const text = el("path", { fill: ink, d: glyphs.map((g) => g.d).join("") });
  return svgDoc(mark + text, { width: LOCKUP.width, height: LOCKUP.height, title });
}
