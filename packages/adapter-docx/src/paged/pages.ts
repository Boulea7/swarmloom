import type { Blueprint, BoxLayer, CSSMap, Layer, Rect } from "@swarmloom/core";

/** Layers whose box differs from a measured sheet by at most this many px are taken to be that sheet. */
const MATCH_TOLERANCE = 2;

/** Border-box rects of `pages`, relative to the top-left of `root` (the blueprint origin). */
export function measurePages(root: HTMLElement, pages: Iterable<Element>): Rect[] {
  const origin = root.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const page of pages) {
    const r = page.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    rects.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  }
  return rects;
}

function near(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) <= MATCH_TOLERANCE &&
    Math.abs(a.y - b.y) <= MATCH_TOLERANCE &&
    Math.abs(a.w - b.w) <= MATCH_TOLERANCE &&
    Math.abs(a.h - b.h) <= MATCH_TOLERANCE
  );
}

function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function containsRect(outer: Rect, inner: Rect): boolean {
  const t = MATCH_TOLERANCE;
  return (
    inner.x >= outer.x - t &&
    inner.y >= outer.y - t &&
    inner.x + inner.w <= outer.x + outer.w + t &&
    inner.y + inner.h <= outer.y + outer.h + t
  );
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/**
 * Turns measured sheets into page layers of `blueprint` (in place) so pages are built first:
 *  - a box layer matching a sheet gets role "page"; sheets without a matching layer get a new box layer,
 *  - every layer inside a sheet whose parent is missing or lies outside that sheet gets the sheet as parent,
 *  - sheets below the snapshot's height (truncated content) are dropped or clipped.
 * Each page layer carries `meta.page` (1-based).
 */
export function markPages(blueprint: Blueprint, sheets: readonly Rect[], style: CSSMap): Blueprint {
  const limit = blueprint.size.h;
  const pages = sheets.filter((s) => s.y < limit).map((s) => ({ ...s, h: Math.min(s.h, limit - s.y) }));
  if (pages.length === 0) return blueprint;

  const layers = blueprint.layers;
  const used = new Set(layers.map((l) => l.id));
  const zs = layers.flatMap((l) => (l.z === undefined ? [] : [l.z]));
  const pageIds: string[] = [];
  const created: BoxLayer[] = [];
  for (const [i, rect] of pages.entries()) {
    const match = layers.find((l): l is BoxLayer => l.kind === "box" && l.role !== "page" && near(l.box, rect));
    if (match) {
      match.role = "page";
      match.meta = { ...match.meta, page: i + 1 };
      pageIds.push(match.id);
      continue;
    }
    const layer: BoxLayer = {
      id: uniqueId(`page-${i + 1}`, used),
      kind: "box",
      box: { ...rect },
      role: "page",
      style: { ...style },
      meta: { page: i + 1 },
    };
    if (zs.length > 0) layer.z = Math.min(...zs) - 1;
    created.push(layer);
    pageIds.push(layer.id);
  }
  // Synthesized sheets go first so that, without explicit z, array order paints them below the content.
  if (created.length > 0) blueprint.layers = [...created, ...layers];

  const byId = new Map<string, Layer>(blueprint.layers.map((l) => [l.id, l]));
  const pageSet = new Set(pageIds);
  for (const layer of blueprint.layers) {
    if (pageSet.has(layer.id) || layer.kind === "guide") continue;
    const cx = layer.box.x + layer.box.w / 2;
    const cy = layer.box.y + layer.box.h / 2;
    const index = pages.findIndex((p) => containsPoint(p, cx, cy));
    if (index < 0) continue;
    const parent = layer.parent ? byId.get(layer.parent) : undefined;
    if (!parent || (!pageSet.has(parent.id) && !containsRect(pages[index]!, parent.box))) {
      layer.parent = pageIds[index];
    }
  }
  return blueprint;
}
