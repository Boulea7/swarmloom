/**
 * Fold-aware toolbar placement for dual-screen and foldable devices (Viewport Segments API).
 *
 * With two or more segments overlapping the player, the toolbar sits inside one segment so it
 * never straddles the hinge: the bottom-most (then right-most) segment that does not contain the
 * build focus. Side by side, that is the segment beside the focus; stacked with the focus below
 * the hinge, the toolbar moves just above the hinge. Without segments it stays bottom-centre.
 */

import type { Point } from "../types";

/** A rectangle in client (viewport) coordinates. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where to put the dock, relative to the controls' container (host) box. */
export interface DockPlacement {
  /** Index into the segment list the decision was made from. */
  segment: number;
  left: number;
  width: number;
  /** Distance from the host's bottom edge to the bottom of the chosen segment. */
  bottom: number;
}

const MIN_SEGMENT_PX = 120;

/**
 * @param host Client rect of the element the dock is positioned in.
 * @param segments Viewport segments in client coordinates, or null when the API is unavailable.
 * @param focus Client point where the build currently happens, or null when unknown.
 * @param current Segment the toolbar occupies now (kept when still valid, to avoid jumping).
 * @returns The placement, or null for the default bottom-centre layout.
 */
export function placeDock(
  host: ClientRect,
  segments: readonly ClientRect[] | null,
  focus: Point | null,
  current: number | null,
): DockPlacement | null {
  if (!segments || segments.length < 2) return null;
  const visible: Array<{ index: number; rect: ClientRect }> = [];
  segments.forEach((segment, index) => {
    const rect = intersect(host, segment);
    if (rect && rect.width >= MIN_SEGMENT_PX && rect.height >= MIN_SEGMENT_PX) visible.push({ index, rect });
  });
  if (visible.length < 2) return null;

  const free = focus ? visible.filter((v) => !contains(v.rect, focus)) : visible;
  const candidates = free.length > 0 ? free : visible;
  const keep = current !== null ? candidates.find((v) => v.index === current) : undefined;
  const chosen = keep ?? candidates.reduce((best, v) => (better(v.rect, best.rect) ? v : best));

  const hostBottom = host.top + host.height;
  const segBottom = chosen.rect.top + chosen.rect.height;
  return {
    segment: chosen.index,
    left: round(chosen.rect.left - host.left),
    width: round(chosen.rect.width),
    bottom: round(Math.max(0, hostBottom - segBottom)),
  };
}

/** Reads `window.viewport.segments` (Chromium 138+); null when unsupported or not segmented. */
export function readSegments(win: Window): ClientRect[] | null {
  const viewport = (win as Window & { viewport?: { segments?: unknown } }).viewport;
  const list = viewport?.segments;
  if (!Array.isArray(list) || list.length < 2) return null;
  const rects: ClientRect[] = [];
  for (const item of list) {
    const r = toRect(item);
    if (!r) return null;
    rects.push(r);
  }
  return rects;
}

function toRect(value: unknown): ClientRect | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<Record<"left" | "top" | "x" | "y" | "width" | "height", unknown>>;
  const left = num(v.left ?? v.x);
  const top = num(v.top ?? v.y);
  const width = num(v.width);
  const height = num(v.height);
  if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intersect(a: ClientRect, b: ClientRect): ClientRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function contains(r: ClientRect, p: Point): boolean {
  return p.x >= r.left && p.x < r.left + r.width && p.y >= r.top && p.y < r.top + r.height;
}

/** Prefers the lower segment, then the one further right (the toolbar is bottom-anchored). */
function better(a: ClientRect, b: ClientRect): boolean {
  const ab = a.top + a.height;
  const bb = b.top + b.height;
  if (Math.abs(ab - bb) > 1) return ab > bb;
  return a.left > b.left;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
