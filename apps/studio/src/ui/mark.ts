/**
 * Geometry of the SwarmLoom Studio mark: a Loom Indigo rounded square, three woven strands and a
 * small cursor, on a 32 px grid. This module is DOM-free so the build can rasterize the same shapes
 * into PWA icons (build/icons.ts) and write the favicon; `brandMark()` in ./icons draws it inline.
 */

export type Pt = readonly [number, number];
/** Cubic segment: start, control 1, control 2, end. */
export type Cubic = readonly [Pt, Pt, Pt, Pt];

export const MARK_SIZE = 32;
export const MARK_BG = { x: 1, y: 1, size: 30, radius: 9, color: "#5B5BF7" } as const;
export const MARK_PAPER = "#FAFAFC";
export const MARK_CURSOR_COLOR = "#FF4F7B";
export const MARK_STRAND_WIDTH = 1.8;
export const MARK_CURSOR_OUTLINE = 0.8;

function strand(y: number): readonly Cubic[] {
  return [
    [
      [8, y],
      [11.2, y - 2.4],
      [14.4, y + 2.4],
      [17.6, y],
    ],
    [
      [17.6, y],
      [20.8, y - 2.4],
      [22.4, y - 1.6],
      [24, y],
    ],
  ];
}

/** Three weft strands, each two cubic segments. */
export const MARK_STRANDS: readonly (readonly Cubic[])[] = [strand(11.5), strand(16), strand(20.5)];

/** Cursor outline (corners are softened by the outline's round join). */
export const MARK_CURSOR: readonly Pt[] = [
  [20.6, 18.4],
  [19.87, 18.78],
  [19.87, 24.88],
  [20.64, 25.21],
  [22.14, 23.81],
  [23.22, 26.11],
  [23.85, 26.34],
  [24.55, 26.03],
  [24.78, 25.4],
  [23.72, 23.13],
  [25.76, 23.0],
  [26.01, 22.2],
];

const n = (v: number) => Number(v.toFixed(2));

/** SVG path data of one strand. */
export function strandPath(segments: readonly Cubic[]): string {
  const [first] = segments;
  if (!first) return "";
  let d = `M${n(first[0][0])} ${n(first[0][1])}`;
  for (const [, c1, c2, end] of segments)
    d += `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(end[0])} ${n(end[1])}`;
  return d;
}

/** SVG path data of the cursor. */
export function cursorPath(): string {
  return `M${MARK_CURSOR.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;
}

/** The mark as a standalone SVG document (favicon). */
export function markSvg(): string {
  const strands = MARK_STRANDS.map(strandPath).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}">`,
    `<rect x="${MARK_BG.x}" y="${MARK_BG.y}" width="${MARK_BG.size}" height="${MARK_BG.size}" rx="${MARK_BG.radius}" fill="${MARK_BG.color}"/>`,
    `<path d="${strands}" fill="none" stroke="${MARK_PAPER}" stroke-width="${MARK_STRAND_WIDTH}" stroke-linecap="round"/>`,
    `<path d="${cursorPath()}" fill="${MARK_CURSOR_COLOR}" stroke="${MARK_PAPER}" stroke-width="${MARK_CURSOR_OUTLINE}" stroke-linejoin="round"/>`,
    "</svg>",
  ].join("");
}
