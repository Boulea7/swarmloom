import type { CursorShape } from "../types";

/**
 * Original SwarmLoom cursor artwork, designed on a 24-unit grid.
 *
 * The idle arrow is a "shuttle dart": a symmetric arrowhead with slightly convex flanks, a rounded tip
 * and a concave tail notch (a loom shuttle's point), not an operating-system arrow. Tools share the
 * same language: coloured body, soft white outline, subtle shadow.
 *
 * Every shape is either a filled `body` (outlined by a wide white stroke drawn first, so overlapping
 * sub-paths read as one silhouette) or a stroked `glyph` (white underlay plus a coloured line), or both.
 */
export interface ShapeDef {
  /** Filled silhouette in grid units. */
  body?: string;
  /** Use the even-odd rule for `body` (cut-outs such as the pen nib hole). */
  evenOdd?: boolean;
  /** Stroked line-art in grid units (crosshair, I-beam). */
  glyph?: string;
  /** Thin decorative strokes drawn over the body in a translucent tint (creases, slits). */
  detail?: string;
  /** Translucent white highlight stroke over the body. */
  highlight?: string;
  /** Small "+" badge (copy tool): centre and radius in grid units. */
  badge?: { x: number; y: number; r: number };
  /** The pixel that touches the target, in grid units. */
  hot: { x: number; y: number };
  /** Whether the art may tilt with the agent's heading (directional arrows only). */
  tilts: boolean;
  /** Name-tag offset from the hotspot, CSS px (kept clear of the art). */
  tag: { x: number; y: number };
}

const rotateAbout = (pts: readonly number[], angle: number, cx: number, cy: number): string => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let d = "";
  for (let i = 0; i < pts.length; i += 2) {
    const x = (pts[i] ?? 0) - cx;
    const y = (pts[i + 1] ?? 0) - cy;
    const rx = cx + x * cos - y * sin;
    const ry = cy + x * sin + y * cos;
    d += `${i === 0 ? "M" : "L"}${rx.toFixed(2)} ${ry.toFixed(2)}`;
  }
  return `${d}Z`;
};

const DART =
  "M4.3 2.7Q10.62 4.91 17.5 9.2Q18.4 9.64 17.4 9.71Q12.95 9.07 10.2 10.2" +
  "Q9.07 12.95 9.71 17.4Q9.64 18.4 9.2 17.5Q4.91 10.62 2.7 4.3Q2 2 4.3 2.7Z";

/** Horizontal double arrow, rotated 45 degrees for the diagonal resize handle. */
const RESIZE_PTS = [
  3.5, 12, 7.6, 8.6, 7.6, 10.85, 16.4, 10.85, 16.4, 8.6, 20.5, 12, 16.4, 15.4, 16.4, 13.15, 7.6, 13.15, 7.6, 15.4,
];

const MOVE =
  "M12 3L15.4 6.6H13.2V10.8H17.4V8.6L21 12L17.4 15.4V13.2H13.2V17.4H15.4L12 21L8.6 17.4H10.8V13.2H6.6V15.4" +
  "L3 12L6.6 8.6V10.8H10.8V6.6H8.6Z";

/** Rounded rectangle path in grid units. */
const rr = (x: number, y: number, w: number, h: number, r: number): string =>
  `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}` +
  `H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

/** Circle as two arcs, grid units. */
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;

/** Rotated ellipse as two SVG arcs, grid units; `deg` rotates the major axis. */
const ellipse = (cx: number, cy: number, rx: number, ry: number, deg: number): string => {
  const a = (deg * Math.PI) / 180;
  const dx = rx * Math.cos(a);
  const dy = rx * Math.sin(a);
  return `M${cx - dx} ${cy - dy}A${rx} ${ry} ${deg} 1 0 ${cx + dx} ${cy + dy}A${rx} ${ry} ${deg} 1 0 ${cx - dx} ${cy - dy}Z`;
};

export const SHAPES: Readonly<Record<CursorShape, ShapeDef>> = {
  arrow: {
    body: DART,
    highlight: "M5.2 3.7Q10.2 5.6 15.6 8.6",
    hot: { x: 2.75, y: 2.75 },
    tilts: true,
    tag: { x: 13, y: 17 },
  },
  copy: {
    body: DART,
    highlight: "M5.2 3.7Q10.2 5.6 15.6 8.6",
    badge: { x: 17.6, y: 17.6, r: 4.4 },
    hot: { x: 2.75, y: 2.75 },
    tilts: true,
    tag: { x: 15, y: 19 },
  },
  crosshair: {
    glyph: "M12 3.2V9.4M12 14.6V20.8M3.2 12H9.4M14.6 12H20.8",
    body: circle(12, 12, 1.15),
    hot: { x: 12, y: 12 },
    tilts: false,
    tag: { x: 11, y: 11 },
  },
  ibeam: {
    glyph:
      "M8.8 4.4C10.6 4.4 12 5.2 12 6.9V17.1C12 18.8 10.6 19.6 8.8 19.6" +
      "M15.2 4.4C13.4 4.4 12 5.2 12 6.9M15.2 19.6C13.4 19.6 12 18.8 12 17.1M10.3 12H13.7",
    hot: { x: 12, y: 12 },
    tilts: false,
    tag: { x: 8, y: 10 },
  },
  pen: {
    body:
      "M3 21L6.39 10.25Q8.2 7.4 11.56 7.64L16.36 12.44Q16.6 15.8 13.75 17.61Z" +
      "M11.84 6.78L13.74 4.88L19.12 10.26L17.22 12.16Z" +
      circle(9.01, 14.99, 1.35),
    evenOdd: true,
    detail: "M3.9 20.1L8.05 15.95",
    hot: { x: 3.2, y: 20.8 },
    tilts: false,
    tag: { x: 7, y: 3 },
  },
  hand: {
    body:
      rr(8.6, 2.2, 3.8, 11.4, 1.9) +
      rr(7.2, 9.8, 12.4, 11.8, 4.2) +
      circle(14.3, 10.7, 1.9) +
      circle(17.6, 11.6, 1.8) +
      ellipse(6.3, 14.6, 3.6, 1.9, 48),
    detail: "M12.6 11.4V14.2M15.95 11.9V14.4",
    hot: { x: 10.5, y: 2.4 },
    tilts: false,
    tag: { x: 9, y: 20 },
  },
  grab: {
    body:
      rr(5.6, 8.6, 13.6, 11.6, 4.2) +
      circle(8.1, 9.3, 2.4) +
      circle(11.4, 8.6, 2.4) +
      circle(14.7, 8.6, 2.4) +
      circle(17.5, 9.5, 2.2) +
      ellipse(5.4, 14.6, 3.0, 1.9, 70),
    detail: "M9.75 9.8V12.4M13.05 9.3V12.1M16.15 9.6V12.2",
    hot: { x: 12, y: 13 },
    tilts: false,
    tag: { x: 9, y: 9 },
  },
  move: { body: MOVE, hot: { x: 12, y: 12 }, tilts: false, tag: { x: 11, y: 11 } },
  resize: {
    body: rotateAbout(RESIZE_PTS, Math.PI / 4, 12, 12),
    hot: { x: 12, y: 12 },
    tilts: false,
    tag: { x: 11, y: 11 },
  },
};

/** Returns the definition for `shape`, falling back to the arrow for unknown values. */
export function shapeDef(shape: string): ShapeDef {
  return (SHAPES as Record<string, ShapeDef>)[shape] ?? SHAPES.arrow;
}

/** Rest heading of the arrow art (pointing up-left), radians. */
export const ARROW_HEADING = (-3 * Math.PI) / 4;
