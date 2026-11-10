import { ensureContrast } from "./color.ts";
import { el, esc, n } from "./svg.ts";

/**
 * SwarmLoom cursor: a crescent dart with a softly rounded tip and a curved, tail-less back.
 * Local coordinates: hotspot (tip) at the origin, pointing up-left, about 20 x 20 units.
 * Original artwork; it deliberately avoids the classic OS arrow-with-tail silhouette.
 */
export const CURSOR_PATH = "M.2 .7Q-.5-.5.8-.1L19.3 11.1Q20.4 11.8 19.2 12.2Q12.9 13.1 8.7 19Q8 20.1 7.5 18.8Z";

/** Bounding box of {@link CURSOR_PATH} in local units (control points included). */
export const CURSOR_BOX = { x: -0.5, y: -0.5, w: 20.9, h: 20.6 } as const;

/** System UI stack for name tags (brand.md: 11px/600 system UI). CJK fallbacks keep Chinese names crisp. */
export const UI_FONT =
  'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Noto Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif';

// Advance widths (per 1000 em) for printable ASCII at weight 600 in a neo-grotesque UI face.
// Used only to size tags; real UI fonts (SF, Segoe, Roboto) land within a few percent.
const ASCII_600 =
  "252,321,523,644,650,1004,663,326,373,373,540,673,319,465,319,379,660,423,623,636,666,612,640,576,640,640,319,329,673,673,673,543,999,728,659,737,722,605,588,749,746,277,580,703,565,922,759,769,645,773,652,650,660,736,728,1020,720,713,652,373,379,373,481,469,351,574,624,583,624,591,389,625,612,262,262,569,262,900,612,609,624,624,397,549,353,612,587,839,569,588,566,455,359,455,673"
    .split(",")
    .map(Number);

/** Estimated rendered width of `text` at `size` px and weight 600. CJK and other wide glyphs count as 1 em. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    em += code >= 32 && code < 127 ? (ASCII_600[code - 32] ?? 600) / 1000 : 1;
  }
  return em * size;
}

/** Name tag geometry, shared by every renderer so tags look identical everywhere. */
export const TAG = { height: 20, padX: 7, radius: 6, fontSize: 11, offsetX: 13, offsetY: 17 } as const;

/**
 * Minimum contrast for white tag text; luminous hues (amber, lime, teal...) get a deeper tag fill to reach it.
 * 3:1 keeps the hues vivid; tags are short decorative labels, not content the viewer must read.
 */
export const TAG_MIN_CONTRAST = 3;

/** Tag fill for a cursor colour: the colour itself, deepened toward ink only when white text would be illegible. */
export function tagFill(color: string, ink = "#0B0B12"): string {
  return ensureContrast(color, "#FFFFFF", TAG_MIN_CONTRAST, ink);
}

/** Width of a name tag pill for `label`. */
export function tagWidth(label: string): number {
  return Math.ceil(textWidth(label, TAG.fontSize) + TAG.padX * 2 + 1);
}

/** Options for {@link cursorSvg}. */
export interface CursorOptions {
  color: string;
  /** Name tag text; omitted or empty hides the tag. */
  label?: string;
  /** Uniform scale of the arrow (the tag is never scaled, so it stays 11 px). */
  scale?: number;
  /** Id of a drop-shadow filter defined by the caller (see {@link cursorDefs}). */
  shadowId?: string;
  /** Extra attributes for the outer group (class, transform). */
  className?: string;
  /** Static placement of the hotspot. */
  x?: number;
  y?: number;
}

/** Shared <defs> for cursors: a soft two-layer drop shadow. */
export function cursorDefs(id = "sl-cursor-shadow", strength = 1): string {
  return el(
    "filter",
    { id, x: "-40%", y: "-40%", width: "180%", height: "180%", "color-interpolation-filters": "sRGB" },
    el("feDropShadow", { dx: 0, dy: 1, stdDeviation: 0.6, "flood-color": "#0B0B12", "flood-opacity": 0.22 * strength }),
    el("feDropShadow", { dx: 0, dy: 3, stdDeviation: 2.4, "flood-color": "#0B0B12", "flood-opacity": 0.16 * strength }),
  );
}

/** Name tag pill positioned relative to the cursor hotspot. */
export function nameTag(label: string, color: string): string {
  const w = tagWidth(label);
  const { height: h, radius: r, offsetX: x, offsetY: y } = TAG;
  return el(
    "g",
    { transform: `translate(${n(x)} ${n(y)})` },
    el("rect", { width: w, height: h, rx: r, fill: tagFill(color) }),
    el("rect", {
      x: 0.5,
      y: 0.5,
      width: w - 1,
      height: h - 1,
      rx: r - 0.5,
      stroke: "#FFFFFF",
      "stroke-opacity": 0.28,
      fill: "none",
    }),
    // textLength pins the label to the pill on every platform font (SF, Segoe, Roboto, Noto).
    `<text x="${n(w / 2)}" y="14" text-anchor="middle" fill="#FFFFFF" font-family='${UI_FONT}' font-size="${TAG.fontSize}" font-weight="600" textLength="${n(w - TAG.padX * 2 - 1)}" lengthAdjust="spacing">${esc(label)}</text>`,
  );
}

/** One cursor (arrow plus optional name tag) as an SVG group, hotspot at (x, y). */
export function cursorSvg(opts: CursorOptions): string {
  const scale = opts.scale ?? 1;
  const arrow = el("path", {
    d: CURSOR_PATH,
    transform: scale === 1 ? undefined : `scale(${n(scale)})`,
    fill: opts.color,
    stroke: "#FFFFFF",
    "stroke-width": 2 / scale,
    "stroke-linejoin": "round",
    "paint-order": "stroke",
  });
  const tag = opts.label ? nameTag(opts.label, opts.color) : "";
  const placed = opts.x !== undefined || opts.y !== undefined;
  return el(
    "g",
    {
      class: opts.className,
      transform: placed ? `translate(${n(opts.x ?? 0)} ${n(opts.y ?? 0)})` : undefined,
      filter: opts.shadowId ? `url(#${opts.shadowId})` : undefined,
    },
    arrow,
    tag,
  );
}
