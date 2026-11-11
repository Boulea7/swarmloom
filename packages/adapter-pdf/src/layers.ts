/**
 * PageScan -> blueprint layers for one page sheet:
 *   page box -> stray ink crops -> vector paths and figure crops (paint order) -> typed text-line crops.
 *
 * Every crop is cut from the same bitmap pdf.js rendered, so the finished stage
 * shows the page pixel for pixel. Figure and ink crops come from a copy with
 * the text-line rectangles punched out (when they overlap text), so sweeping a
 * figure never shows text before its line is typed.
 */

import type { BoxLayer, ImageLayer, Layer, PathLayer, Rect } from "@swarmloom/core";
import { hex } from "./bitmap";
import { hasInk, type InkMap, residualInk } from "./coverage";
import { area, type Edges, expand, intersect, isEmpty, mergeNear, near, union } from "./geometry";
import { toPathData, type VectorShape } from "./operators";
import type { PageBasics, PageScan } from "./page";
import { roleOf, type TextBlock, type TextLine } from "./text";

/** Text crops reach this far past the font box (fraction of the font size) to keep accents and descenders. */
const PAD_Y = 0.12;
const PAD_X = 0.08;
/** Rotated lines (beyond ~3 degrees) are swept instead of typed left to right. */
const TYPE_MAX_ANGLE = 0.05;
/** Straight paths up to this many segments are drawn anchor by anchor with the pen; longer ones are traced. */
const PEN_MAX_SEGMENTS = 12;
const MERGE_MAX_SEGMENTS = 64;
const MIN_CROP_AREA = 9;

export const PAGE_SHADOW = "0 1px 2px rgba(11, 11, 18, 0.10), 0 6px 20px rgba(11, 11, 18, 0.08)";

/** A text line's crop: device-pixel rect in the bitmap and the matching page CSS rect. */
export interface LineCrop {
  line: TextLine;
  /** Index into `PageScan.blocks`. */
  block: number;
  device: Edges;
  css: Edges;
}

export interface PageLayout {
  /** Stage position of the page's top-left corner. */
  x: number;
  y: number;
}

/** Snaps a page CSS box outwards to whole device pixels of the bitmap; returns both rects. */
export function snapCrop(e: Edges, scan: Pick<PageScan, "ratio" | "natural">): { device: Edges; css: Edges } {
  const r = scan.ratio;
  const device = {
    x0: Math.max(0, Math.floor(e.x0 * r)),
    y0: Math.max(0, Math.floor(e.y0 * r)),
    x1: Math.min(scan.natural.w, Math.ceil(e.x1 * r)),
    y1: Math.min(scan.natural.h, Math.ceil(e.y1 * r)),
  };
  return { device, css: { x0: device.x0 / r, y0: device.y0 / r, x1: device.x1 / r, y1: device.y1 / r } };
}

/** Crops for every visible text line, in content order. */
export function lineCrops(scan: PageBasics, map: InkMap): LineCrop[] {
  const page: Edges = { x0: 0, y0: 0, x1: scan.width, y1: scan.height };
  const out: LineCrop[] = [];
  scan.blocks.forEach((block, b) => {
    for (const line of block.lines) {
      if (!hasInk(map, line.edges)) continue;
      const padded = intersect(expand(line.edges, PAD_X * line.size + 0.5, PAD_Y * line.size + 0.5), page);
      const { device, css } = snapCrop(padded, scan);
      if (area(device) < MIN_CROP_AREA) continue;
      out.push({ line, block: b, device, css });
    }
  });
  return out;
}

function toRect(e: Edges, at: PageLayout): Rect {
  return { x: at.x + e.x0, y: at.y + e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0 };
}

function sameAttrs(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function sameClip(a?: Edges, b?: Edges): boolean {
  return a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1);
}

/**
 * Joins shapes of identical style that touch (table grids drawn as many thin rectangles,
 * multi-part rules) so each group becomes one path layer. A shape may join an earlier group
 * only when nothing painted in between overlaps it, so stacking order is preserved.
 * Translucent shapes are kept apart: merging would change how their overlaps blend.
 */
export function mergeShapes(shapes: readonly VectorShape[]): VectorShape[] {
  const out: VectorShape[] = [];
  for (const s of shapes) {
    const opaque = !("fill-opacity" in s.attrs || "stroke-opacity" in s.attrs);
    let target = -1;
    for (let i = out.length - 1; opaque && i >= 0; i--) {
      const g = out[i] as VectorShape;
      if (
        g.stroke === s.stroke &&
        g.fill === s.fill &&
        g.strokeWidth === s.strokeWidth &&
        sameAttrs(g.attrs, s.attrs) &&
        sameClip(g.clip, s.clip) &&
        g.segments + s.segments <= MERGE_MAX_SEGMENTS &&
        near(g.edges, s.edges, 2)
      ) {
        target = i;
        break;
      }
      if (!isEmpty(intersect(expand(g.edges, 0.5), s.edges))) break;
    }
    const g = out[target];
    if (!g) {
      out.push({ ...s, attrs: { ...s.attrs } });
      continue;
    }
    out[target] = {
      ...g,
      cmds: g.cmds.concat(s.cmds),
      segments: g.segments + s.segments,
      straight: g.straight && s.straight,
      edges: union(g.edges, s.edges),
    };
  }
  return out;
}

function overlapsAny(e: Edges, boxes: readonly Edges[]): boolean {
  return boxes.some((b) => !isEmpty(intersect(e, b)));
}

/** The per-page pieces before they become layers; `needsBackdrop` asks for the text-free bitmap copy. */
export interface PagePlan {
  crops: LineCrop[];
  shapes: VectorShape[];
  /** Figure and vector-fallback regions in paint order, page CSS px. */
  regions: { order: number; edges: Edges; kind: "image" | "vector" }[];
  /** Ink no other layer accounts for. */
  stray: Edges[];
  needsBackdrop: boolean;
}

/** Decides what each part of the page becomes. Pure; works on page CSS px. */
export function planPage(scan: PageBasics, map: InkMap): PagePlan {
  const crops = lineCrops(scan, map);
  const shapes = mergeShapes(scan.paint.shapes.filter((s) => hasInk(map, expand(s.edges, 0.5))));
  const regionList = scan.paint.regions.filter((r) => area(r.edges) >= 1 && hasInk(map, r.edges));
  const regions = mergeNear(
    regionList.map((r) => ({ edges: r.edges, order: r.order, kind: r.kind })),
    0,
  ).map((g) => ({
    ...g,
    kind: regionList.some((r) => r.kind === "image" && !isEmpty(intersect(r.edges, g.edges)))
      ? ("image" as const)
      : ("vector" as const),
  }));
  const covered = [...crops.map((c) => c.css), ...shapes.map((s) => s.edges), ...regions.map((r) => r.edges)];
  const stray = residualInk(map, covered).filter((e) => area(e) >= 4);
  const textBoxes = crops.map((c) => c.css);
  const needsBackdrop = [...regions.map((r) => r.edges), ...stray].some((e) => overlapsAny(e, textBoxes));
  return { crops, shapes, regions, stray, needsBackdrop };
}

/**
 * Emits the layers of one page sheet in paint order.
 *
 * @param scan Rendered and planned page.
 * @param at Stage position of the page.
 * @param body Body text size of the whole document (CSS px); larger blocks become headings.
 * @param pageBase Priority of the page sheet; its other layers follow at `pageBase + 1 ...`.
 */
export function pageLayers(scan: PageScan, at: PageLayout, body: number, pageBase: number): Layer[] {
  const { plan } = scan;
  const backdrop = scan.backdrop ?? scan.src;
  const n = scan.number;
  const sheetId = `p${n}`;
  const natural = scan.natural;
  const layers: Layer[] = [];
  const sheet: BoxLayer = {
    id: sheetId,
    kind: "box",
    role: "page",
    box: { x: at.x, y: at.y, w: scan.width, h: scan.height },
    style: { "background-color": hex(scan.paper), "box-shadow": PAGE_SHADOW, "border-radius": "2px" },
    meta: { page: n, textLayer: scan.textItems > 0 },
  };
  layers.push(sheet);

  const crop = (id: string, e: Edges, src: string, extra: Partial<ImageLayer>): ImageLayer | null => {
    const { device, css } = snapCrop(e, scan);
    if (area(device) < MIN_CROP_AREA) return null;
    return {
      id,
      kind: "image",
      parent: sheetId,
      box: toRect(css, at),
      src,
      crop: { x: device.x0, y: device.y0, w: device.x1 - device.x0, h: device.y1 - device.y0 },
      natural,
      fit: "fill",
      reveal: "sweep",
      role: "figure",
      ...extra,
      meta: { page: n, ...extra.meta },
    };
  };

  plan.stray.forEach((e, i) => {
    const layer = crop(`p${n}-k${i}`, e, backdrop, { meta: { part: "ink" } });
    if (layer) layers.push(layer);
  });

  type Painted = { order: number; layer: Layer };
  const painted: Painted[] = [];
  plan.shapes.forEach((s, i) => {
    const path: PathLayer = {
      id: `p${n}-v${i}`,
      kind: "path",
      parent: sheetId,
      role: "shape",
      box: toRect(s.edges, at),
      d: toPathData(s.cmds, at.x, at.y),
      fill: s.fill,
      reveal: s.straight && s.segments <= PEN_MAX_SEGMENTS ? "pen" : "trace",
      meta: { page: n },
    };
    if (s.stroke) {
      path.stroke = s.stroke;
      path.strokeWidth = +(s.strokeWidth ?? 1).toFixed(3);
    }
    if (Object.keys(s.attrs).length > 0) path.attrs = s.attrs;
    if (s.clip) path.clip = toRect(s.clip, at);
    painted.push({ order: s.order, layer: path });
  });
  plan.regions.forEach((r, i) => {
    const layer = crop(`p${n}-f${i}`, r.edges, backdrop, { meta: { part: r.kind } });
    if (layer) painted.push({ order: r.order, layer });
  });
  painted.sort((a, b) => a.order - b.order);
  for (const p of painted) layers.push(p.layer);

  const blockOf = new Map<Layer, number>();
  plan.crops.forEach((c, i) => {
    const { line } = c;
    const typed = Math.abs(line.angle) <= TYPE_MAX_ANGLE;
    const layer: ImageLayer = {
      id: `p${n}-t${i}`,
      kind: "image",
      parent: sheetId,
      role: roleOf(scan.blocks[c.block] as TextBlock, body),
      box: toRect(c.css, at),
      src: scan.src,
      crop: { x: c.device.x0, y: c.device.y0, w: c.device.x1 - c.device.x0, h: c.device.y1 - c.device.y0 },
      natural,
      fit: "fill",
      reveal: typed ? "type" : "sweep",
      // Each crop is one text line: typed left to right at full height, never in bands.
      lines: 1,
      meta: {
        page: n,
        part: "text",
        block: `p${n}-b${c.block}`,
        text: line.text,
        fontSize: +line.size.toFixed(2),
        ...(line.rtl ? { dir: "rtl" } : {}),
      },
    };
    blockOf.set(layer, c.block);
    layers.push(layer);
  });
  // Block tops in stage coordinates, in stream order.
  const tops = scan.blocks.map((b) => at.y + b.edges.y0);
  assignPriorities(layers, blockOf, tops, pageBase);
  return layers;
}

/**
 * Build order follows the content stream, which is the reading order in nearly every
 * producer (and keeps multi-column text from interleaving, unlike a plain y/x sort).
 * Each non-text layer is slotted in before the first text block, in stream order, that
 * starts at or below its top edge, so grids, rules and figures appear just before the
 * text that follows them. Ties keep top-to-bottom, then paint order.
 */
function assignPriorities(
  layers: readonly Layer[],
  blockOf: ReadonlyMap<Layer, number>,
  tops: readonly number[],
  pageBase: number,
): void {
  const slotOf = (top: number): number => {
    const k = tops.findIndex((t) => t >= top - 2);
    return k < 0 ? tops.length : k;
  };
  const keyed = layers.slice(1).map((layer, paint) => {
    const block = blockOf.get(layer);
    // A text block sorts after the layers slotted before it (slot * 2 + 1 vs slot * 2).
    const slot = block === undefined ? slotOf(layer.box.y) * 2 : block * 2 + 1;
    return { layer, slot, paint };
  });
  keyed.sort((a, b) => a.slot - b.slot || (a.slot % 2 === 0 ? a.layer.box.y - b.layer.box.y : 0) || a.paint - b.paint);
  const sheet = layers[0];
  if (sheet) sheet.priority = pageBase;
  keyed.forEach((k, i) => {
    k.layer.priority = pageBase + 1 + i;
  });
}

/** Device-pixel rects of the text crops, for punching them out of the backdrop bitmap. */
export function textHoles(plan: PagePlan): Edges[] {
  return plan.crops.map((c) => c.device);
}
