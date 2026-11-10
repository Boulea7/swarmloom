import { CURSOR_PATH, cursorDefs, nameTag, textWidth, UI_FONT } from "../cursor.ts";
import { EASE_IN_OUT, keyframes, move } from "../motion.ts";
import { cursorColor, type Palette } from "../palette.ts";
import { type Attrs, el, esc, n } from "../svg.ts";
import type { Theme } from "../theme.ts";

/** Drawing context shared by the primitives of one card. */
export interface Kit {
  theme: Theme;
  palette: Palette;
  /** Animation rules and keyframes; emitted only when the viewer allows motion. */
  css: string[];
}

/** Ids of the shared defs every card declares once. */
export const DEF = { shadow: "ks", cloth: "kc" } as const;

/** Cursor colour by palette index. */
export const hue = (k: Kit, i: number): string => cursorColor(k.palette, i);

/** Shared <defs>: cursor shadow and the cross-woven placeholder texture. */
export function kitDefs(k: Kit): string {
  const t = k.theme;
  const cloth = el(
    "pattern",
    { id: DEF.cloth, width: 6, height: 6, patternUnits: "userSpaceOnUse" },
    el("rect", { width: 6, height: 6, fill: t.placeholder }),
    el("path", { d: "M0 3H6M3 0V6", stroke: t.line, "stroke-width": 0.6 }),
  );
  return el("defs", {}, cursorDefs(DEF.shadow, t.scheme === "dark" ? 1.6 : 1), cloth);
}

/** Rounded rectangle helper. */
export function box(x: number, y: number, w: number, h: number, r: number, attrs: Attrs): string {
  return el("rect", { x, y, width: w, height: h, rx: r || undefined, ...attrs });
}

/** App or browser window: raised surface, hairline border and a top bar with an optional address pill. */
export function windowFrame(k: Kit, x: number, y: number, w: number, h: number, opts: { url?: boolean } = {}): string {
  const t = k.theme;
  const dots = [0, 1, 2].map((i) => el("circle", { cx: x + 12 + i * 9, cy: y + 10, r: 2.6, fill: t.bar })).join("");
  const url = opts.url ? box(x + 46, y + 5, Math.min(140, w - 70), 10, 5, { fill: t.placeholder }) : "";
  return (
    box(x, y, w, h, 10, { fill: t.surface, stroke: t.line }) +
    el("path", { d: `M${n(x)} ${n(y + 20.5)}H${n(x + w)}`, stroke: t.line }) +
    dots +
    url
  );
}

/** Text stand-ins: rounded bars of the given widths, one per line. */
export function bars(
  x: number,
  y: number,
  widths: readonly number[],
  color: string,
  opts: { h?: number; gap?: number } = {},
): string {
  const h = opts.h ?? 5;
  const gap = opts.gap ?? 10;
  return widths.map((w, i) => box(x, y + i * gap, w, h, h / 2, { fill: color })).join("");
}

/** Placeholder for content not yet built: the unwoven cloth texture. */
export function cloth(x: number, y: number, w: number, h: number, r = 5): string {
  return box(x, y, w, h, r, { fill: `url(#${DEF.cloth})` });
}

/** Brand cursor with an optional name tag; `cls` hooks it to an animation. */
export function pointer(k: Kit, x: number, y: number, colorIndex: number, label?: string, cls?: string): string {
  const color = hue(k, colorIndex);
  const arrow = el("path", {
    d: CURSOR_PATH,
    fill: color,
    stroke: "#FFFFFF",
    "stroke-width": 2,
    "stroke-linejoin": "round",
    "paint-order": "stroke",
  });
  const inner = el(
    "g",
    { transform: `translate(${n(x)} ${n(y)})`, filter: `url(#${DEF.shadow})` },
    arrow,
    label ? nameTag(label, color) : "",
  );
  return cls ? el("g", { class: cls }, inner) : inner;
}

/** Small solid pill with white text (size badges, page counters, format chips). */
export function pill(x: number, y: number, text: string, color: string, size = 10): string {
  const w = Math.ceil(textWidth(text, size) + 12);
  const h = size + 8;
  return (
    box(x, y, w, h, 5, { fill: color }) +
    `<text x="${n(x + w / 2)}" y="${n(y + h / 2 + size * 0.36)}" text-anchor="middle" font-size="${size}" font-weight="600" fill="#FFFFFF" textLength="${n(w - 12)}" lengthAdjust="spacing">${esc(text)}</text>`
  );
}

/** Selection outline with round knot handles and an optional size badge under it. */
export function selectBox(x: number, y: number, w: number, h: number, color: string, badge?: string): string {
  const knots = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]
    .map(([cx, cy]) => el("circle", { cx, cy, r: 2.4 }))
    .join("");
  const label = badge ? pill(x + w / 2 - (textWidth(badge, 9) + 12) / 2, y + h + 6, badge, color, 9) : "";
  return (
    box(x, y, w, h, 2, { stroke: color, "stroke-width": 1.4, fill: "none" }) +
    el("g", { fill: "#FFFFFF", stroke: color, "stroke-width": 1.4 }, knots) +
    label
  );
}

/** Text caret; `cls` lets the card blink it. */
export function caret(x: number, y: number, h: number, color: string, cls = "blink"): string {
  return el("path", {
    class: cls,
    d: `M${n(x)} ${n(y)}V${n(y + h)}`,
    stroke: color,
    "stroke-width": 1.6,
    "stroke-linecap": "round",
  });
}

/** Guide line drawn as running stitches (dashes) in the accent colour. */
export function stitch(k: Kit, x1: number, y1: number, x2: number, y2: number): string {
  return el("path", {
    d: `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`,
    stroke: k.palette.accent,
    "stroke-width": 1.2,
    "stroke-dasharray": "4 3",
    "stroke-linecap": "round",
  });
}

/** Small caption text in the UI face. */
export function label(
  x: number,
  y: number,
  text: string,
  color: string,
  size = 10,
  weight = 600,
  anchor = "start",
): string {
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-weight="${weight}" fill="${color}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${esc(text)}</text>`;
}

/**
 * Registers a gentle back-and-forth drift for elements with class `cls` (used for one cursor per card).
 * The un-animated state is the drawn position, so static renderers and reduced motion see the base frame.
 */
export function drift(k: Kit, cls: string, dx: number, dy: number, seconds = 3.2): void {
  k.css.push(
    `.${cls}{animation:${cls} ${seconds}s infinite}`,
    keyframes(cls, [
      { at: 0, props: { transform: "none" }, ease: EASE_IN_OUT },
      { at: 0.5, props: { transform: move(dx, dy) }, ease: EASE_IN_OUT },
      { at: 1, props: { transform: "none" } },
    ]),
  );
}

/** Static CSS every card shares: the UI font for text. */
export function staticCss(): string {
  return `text{font-family:${UI_FONT}}`;
}

/** Motion rules every card shares: a stepped caret blink. Collected into {@link Kit.css}. */
export function baseCss(): string[] {
  return [
    ".blink{animation:blink 1.1s steps(1) infinite}",
    "@keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:1}}",
  ];
}
