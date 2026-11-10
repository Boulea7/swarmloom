import { CURSOR_PATH } from "./cursor.ts";
import type { Palette } from "./palette.ts";
import { el, n, svgDoc } from "./svg.ts";

/**
 * The SwarmLoom mark: a cursor woven into a loom.
 * A white crescent cursor sits on an indigo tile crossed by diagonal warp threads; it passes over the
 * outer threads and under the coral weft, so the pointer itself becomes the shuttle.
 * Everything is drawn on a 32-unit grid so the 16 px favicon lands on whole and half pixels.
 */
export const MARK_GRID = 32;

/** Hotspot of the cursor inside the tile (grid units). */
export const CURSOR_AT = { x: 6.9, y: 4.5 } as const;
/** Thread direction (degrees) and the point the thread field is centred on. */
const THREAD_ANGLE = -31;
const THREAD_CENTER = { x: 16.5, y: 14 } as const;

/** One straight thread across the tile. */
interface Thread {
  offset: number;
  width: number;
  /** true: drawn above the cursor (the weft); false: tucked under it (a warp). */
  over: boolean;
  role: "warp" | "weft";
}

const THREADS: readonly Thread[] = [
  { offset: -6, width: 1.2, over: false, role: "warp" },
  { offset: 0, width: 1.6, over: true, role: "weft" },
  { offset: 6, width: 1.2, over: false, role: "warp" },
];

/** Favicon tuning: threads are thickened so they survive 16 px rasterisation. */
const FAVICON_THREADS: readonly Thread[] = [
  { offset: -6.5, width: 1.6, over: false, role: "warp" },
  { offset: 0, width: 2, over: true, role: "weft" },
  { offset: 6.5, width: 1.6, over: false, role: "warp" },
];

/** Visual parameters of one mark rendition. */
export interface MarkStyle {
  /** Gradient stops of the tile, top-left to bottom-right. */
  from: string;
  to: string;
  cursor: string;
  warp: string;
  weft: string;
  /** Corner radius in grid units; 0 for full-bleed (maskable) renditions. */
  radius: number;
  /** Scale of the artwork around the tile centre (maskable icons shrink it into the safe zone). */
  contentScale: number;
  /** Optional 1-unit inner hairline that separates the tile from dark surroundings. */
  hairline?: string;
  /** Use the heavier favicon thread set. */
  favicon?: boolean;
}

/** Gap (grid units) between the cursor and threads it crosses; keeps the over/under legible. */
const GAP = 0.6;

/** Named renditions derived from the palette. */
export function markStyles(p: Palette): Record<"light" | "dark" | "maskable" | "favicon", MarkStyle> {
  const base = { cursor: p.mark.cursor, warp: p.mark.warp, weft: p.mark.weft, radius: 7.5, contentScale: 1 };
  return {
    light: { ...base, from: p.mark.tileFrom, to: p.mark.tileTo },
    dark: { ...base, from: p.mark.tileFromDark, to: p.mark.tileToDark, hairline: "rgba(255,255,255,.16)" },
    maskable: { ...base, from: p.mark.tileFrom, to: p.mark.tileTo, radius: 0, contentScale: 0.76 },
    favicon: { ...base, from: p.mark.tileFrom, to: p.mark.tileTo, radius: 7, favicon: true },
  };
}

function threadPath(t: Thread): string {
  const a = (THREAD_ANGLE * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const cx = THREAD_CENTER.x - dy * t.offset;
  const cy = THREAD_CENTER.y + dx * t.offset;
  const half = 26;
  return `M${n(cx - dx * half)} ${n(cy - dy * half)}L${n(cx + dx * half)} ${n(cy + dy * half)}`;
}

/** Options for {@link markBody}. */
export interface MarkBodyOptions {
  /** Namespaces the gradient and clip ids so several marks can share one document. */
  id?: string;
  /** Class put on the weft (and its gap) with pathLength=1, so animations can draw it in with dashes. */
  weftClass?: string;
}

/** Mark artwork (no <svg> wrapper) on the 32-unit grid, for embedding at any position via a transform. */
export function markBody(style: MarkStyle, opts: MarkBodyOptions = {}): string {
  const id = opts.id ?? "sl-mark";
  const g = MARK_GRID;
  const paint = `url(#${id}-g)`;
  const threads = style.favicon ? FAVICON_THREADS : THREADS;
  const under = threads.filter((t) => !t.over);
  const over = threads.filter((t) => t.over);
  const line = (t: Thread, stroke: string, extra = 0) =>
    el("path", {
      d: threadPath(t),
      stroke,
      "stroke-width": t.width + extra,
      "stroke-linecap": "round",
      class: t.over ? opts.weftClass : undefined,
      pathLength: t.over && opts.weftClass ? 1 : undefined,
    });
  // The background gradient is in user space, so stroking with it reproduces the tile exactly:
  // that is how gaps are cut without masks (masks render inconsistently in some image pipelines).
  const cursor = el("path", {
    d: CURSOR_PATH,
    transform: `translate(${n(CURSOR_AT.x)} ${n(CURSOR_AT.y)})`,
    fill: style.cursor,
    stroke: paint,
    "stroke-width": GAP * 2,
    "stroke-linejoin": "round",
    "paint-order": "stroke",
  });
  const art = [
    ...under.map((t) => line(t, style.warp)),
    cursor,
    ...over.map((t) => line(t, paint, GAP * 2)),
    ...over.map((t) => line(t, t.role === "weft" ? style.weft : style.warp)),
  ].join("");
  const s = style.contentScale;
  const scaled =
    s === 1
      ? art
      : el("g", { transform: `translate(${n((g * (1 - s)) / 2)} ${n((g * (1 - s)) / 2)}) scale(${n(s)})` }, art);
  const hairline = style.hairline
    ? el("rect", {
        x: 0.5,
        y: 0.5,
        width: g - 1,
        height: g - 1,
        rx: Math.max(0, style.radius - 0.5),
        stroke: style.hairline,
        "stroke-width": 1,
        fill: "none",
      })
    : "";
  return [
    el(
      "defs",
      {},
      el(
        "linearGradient",
        { id: `${id}-g`, x1: 0, y1: 0, x2: g, y2: g, gradientUnits: "userSpaceOnUse" },
        el("stop", { offset: 0, "stop-color": style.from }),
        el("stop", { offset: 1, "stop-color": style.to }),
      ),
      el("clipPath", { id: `${id}-c` }, el("rect", { width: g, height: g, rx: style.radius || undefined })),
    ),
    el(
      "g",
      { "clip-path": `url(#${id}-c)` },
      el("rect", { width: g, height: g, fill: paint }),
      el("g", { fill: "none" }, scaled),
      hairline,
    ),
  ].join("");
}

/** Standalone mark SVG at `size` px (the viewBox is always the 32-unit grid). */
export function markSvg(style: MarkStyle, size = 512, title = "SwarmLoom"): string {
  return svgDoc(markBody(style), {
    width: MARK_GRID,
    height: MARK_GRID,
    title,
    display: { width: size, height: size },
  });
}

/**
 * favicon.svg: the favicon rendition, with a media query that brightens the tile on dark browser chrome.
 */
export function faviconSvg(p: Palette): string {
  const styles = markStyles(p);
  const css = `@media (prefers-color-scheme:dark){#sl-mark-g stop:first-child{stop-color:${styles.dark.from}}#sl-mark-g stop:last-child{stop-color:${styles.dark.to}}}`;
  return svgDoc(markBody(styles.favicon), { width: MARK_GRID, height: MARK_GRID, title: "SwarmLoom", style: css });
}
