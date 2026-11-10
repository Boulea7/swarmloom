/**
 * Ink scan of a rendered page: finds what differs from the paper colour, so the
 * adapter can (a) drop vector shapes that paint nothing visible and (b) emit
 * bitmap crops for any ink no text, image or vector layer accounts for
 * (outlined text, shadings, annotations, unsupported operators, scans).
 *
 * Works on an RGBA buffer sampled at about one pixel per CSS px.
 */

import { type Edges, isEmpty, mergeNear } from "./geometry";

export type Rgb = readonly [number, number, number];

/** Where the page holds ink: per pixel (one per CSS px) and per `cell`-sized square for quick tests. */
export interface InkMap {
  width: number;
  height: number;
  /** 1 where the pixel differs from the paper colour, row-major `width * height`. */
  px: Uint8Array;
  cell: number;
  cols: number;
  rows: number;
  /** 1 where any pixel of the cell holds ink, row-major `cols * rows`. */
  ink: Uint8Array;
}

const WHITE: Rgb = [255, 255, 255];

/**
 * Paper colour: the dominant colour of the outer pixel ring when at least 60%
 * of it agrees (pages with a coloured background), otherwise white.
 */
export function detectPaper(px: Uint8ClampedArray, width: number, height: number): Rgb {
  if (width < 2 || height < 2) return WHITE;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = px[i] ?? 255;
    const g = px[i + 1] ?? 255;
    const b = px[i + 2] ?? 255;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
    total++;
  };
  const stepX = Math.max(1, Math.floor(width / 256));
  const stepY = Math.max(1, Math.floor(height / 256));
  for (let x = 0; x < width; x += stepX) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    sample(0, y);
    sample(width - 1, y);
  }
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  if (!best || best.n < total * 0.6) return WHITE;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

/** Marks every pixel (and `cell`-sized square) that differs from `paper` by more than `threshold` in any channel. */
export function inkMap(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  paper: Rgb,
  cell = 4,
  threshold = 14,
): InkMap {
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const mask = new Uint8Array(width * height);
  const [pr, pg, pb] = paper;
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      const i = p * 4;
      const d = Math.max(
        Math.abs((px[i] as number) - pr),
        Math.abs((px[i + 1] as number) - pg),
        Math.abs((px[i + 2] as number) - pb),
      );
      if (d > threshold) mask[p] = 1;
    }
  }
  return { width, height, px: mask, cell, cols, rows, ink: cellsOf(mask, width, height, cell, cols, rows) };
}

function cellsOf(
  mask: Uint8Array,
  width: number,
  height: number,
  cell: number,
  cols: number,
  rows: number,
): Uint8Array {
  const cells = new Uint8Array(cols * rows);
  for (let y = 0, p = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++, p++) if (mask[p]) cells[row + Math.floor(x / cell)] = 1;
  }
  return cells;
}

function cellRange(map: InkMap, e: Edges): [c0: number, r0: number, c1: number, r1: number] {
  return [
    Math.max(0, Math.floor(e.x0 / map.cell)),
    Math.max(0, Math.floor(e.y0 / map.cell)),
    Math.min(map.cols - 1, Math.ceil(e.x1 / map.cell) - 1),
    Math.min(map.rows - 1, Math.ceil(e.y1 / map.cell) - 1),
  ];
}

/** True when any ink cell overlaps the box. */
export function hasInk(map: InkMap, e: Edges): boolean {
  if (isEmpty(e)) return false;
  const [c0, r0, c1, r1] = cellRange(map, e);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) if (map.ink[r * map.cols + c]) return true;
  }
  return false;
}

export interface ResidualOptions {
  /** Most regions to return; nearby regions merge until the count fits. Default 40. */
  maxRegions?: number;
}

/**
 * Groups ink pixels that no `covered` box accounts for into page regions (CSS px).
 * A pixel counts as covered when its centre lies inside a covered box grown by one CSS px
 * (anti-aliasing). Leftover cells up to two apart join one region, so outlined words stay together.
 */
export function residualInk(map: InkMap, covered: readonly Edges[], opts: ResidualOptions = {}): Edges[] {
  const maxRegions = opts.maxRegions ?? 40;
  const { cols, rows, cell, width, height } = map;
  const mask = map.px.slice();
  for (const box of covered) {
    if (isEmpty(box)) continue;
    const xa = Math.max(0, Math.ceil(box.x0 - 1.5));
    const xb = Math.min(width - 1, Math.floor(box.x1 + 0.5));
    const ya = Math.max(0, Math.ceil(box.y0 - 1.5));
    const yb = Math.min(height - 1, Math.floor(box.y1 + 0.5));
    if (xb < xa) continue;
    for (let y = ya; y <= yb; y++) mask.fill(0, y * width + xa, y * width + xb + 1);
  }
  const left = cellsOf(mask, width, height, cell, cols, rows);

  const found: { edges: Edges; order: number }[] = [];
  const stack = new Int32Array(cols * rows);
  for (let start = 0; start < left.length; start++) {
    if (!left[start]) continue;
    let top = 0;
    stack[top++] = start;
    left[start] = 0;
    let c0 = cols;
    let r0 = rows;
    let c1 = -1;
    let r1 = -1;
    while (top > 0) {
      const at = stack[--top] as number;
      const r = Math.floor(at / cols);
      const c = at - r * cols;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      for (let dr = -2; dr <= 2; dr++) {
        const nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        for (let dc = -2; dc <= 2; dc++) {
          const nc = c + dc;
          if (nc < 0 || nc >= cols) continue;
          const n = nr * cols + nc;
          if (left[n]) {
            left[n] = 0;
            stack[top++] = n;
          }
        }
      }
    }
    found.push({
      order: found.length,
      edges: {
        x0: c0 * cell,
        y0: r0 * cell,
        x1: Math.min(map.width, (c1 + 1) * cell),
        y1: Math.min(map.height, (r1 + 1) * cell),
      },
    });
  }
  if (found.length > maxRegions * 8) return bands(found, map.height, maxRegions);
  let regions = mergeNear(found, cell);
  for (let gap = cell * 4; regions.length > maxRegions; gap *= 2) regions = mergeNear(regions, gap);
  return regions.map((r) => r.edges);
}

/** Fallback for very noisy pages: horizontal bands of equal height spanning the ink they contain. */
function bands(found: readonly { edges: Edges }[], height: number, count: number): Edges[] {
  const size = Math.max(1, height / count);
  const out: (Edges | undefined)[] = new Array(count);
  for (const { edges } of found) {
    const k = Math.min(count - 1, Math.floor((edges.y0 + edges.y1) / 2 / size));
    const band = out[k];
    out[k] = band
      ? {
          x0: Math.min(band.x0, edges.x0),
          y0: Math.min(band.y0, edges.y0),
          x1: Math.max(band.x1, edges.x1),
          y1: Math.max(band.y1, edges.y1),
        }
      : { ...edges };
  }
  return out.filter((b): b is Edges => b !== undefined);
}
