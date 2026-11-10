/** Small rectangle/point helpers for choreographies. All values are stage px. */

import type { Layer, Point, Rect } from "../types";
import { clamp } from "./timing";

export type Corner = "tl" | "tr" | "bl" | "br";

const OPPOSITE: Record<Corner, Corner> = { tl: "br", tr: "bl", bl: "tr", br: "tl" };

export function isFinitePoint(p: Point | null | undefined): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** True for a rect with finite coordinates and a non-negative size. */
export function isFiniteRect(r: Rect | null | undefined): r is Rect {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    r.w >= 0 &&
    r.h >= 0
  );
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bottom > y ? { x, y, w: r - x, h: bottom - y } : null;
}

/**
 * The part of a layer a cursor can work on: its box, cut by its clip when it has one.
 * Null when the geometry is invalid or nothing is visible.
 */
export function layerRect(layer: Layer): Rect | null {
  const box = layer.box;
  if (!isFiniteRect(box) || box.w <= 0 || box.h <= 0) return null;
  if (layer.clip === undefined) return { x: box.x, y: box.y, w: box.w, h: box.h };
  return isFiniteRect(layer.clip) ? intersect(box, layer.clip) : null;
}

/** `r` shrunk by `margin` on every side (never below zero size). */
export function insetRect(r: Rect, margin: number): Rect {
  const mx = Math.min(margin, r.w / 2);
  const my = Math.min(margin, r.h / 2);
  return { x: r.x + mx, y: r.y + my, w: r.w - 2 * mx, h: r.h - 2 * my };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function offsetRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

export function sameRect(a: Rect, b: Rect, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon &&
    Math.abs(a.h - b.h) <= epsilon
  );
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function cornerOf(r: Rect, corner: Corner): Point {
  return {
    x: corner === "tr" || corner === "br" ? r.x + r.w : r.x,
    y: corner === "bl" || corner === "br" ? r.y + r.h : r.y,
  };
}

export function oppositeCorner(corner: Corner): Corner {
  return OPPOSITE[corner];
}

/** Keeps a point inside `view`, `margin` px from its edges (or at its centre when the view is tiny). */
export function clampPoint(p: Point, view: Rect, margin: number): Point {
  const mx = Math.min(margin, view.w / 2);
  const my = Math.min(margin, view.h / 2);
  return { x: clamp(p.x, view.x + mx, view.x + view.w - mx), y: clamp(p.y, view.y + my, view.y + view.h - my) };
}

/** Distance from a point to the nearest point of a rect (0 inside). */
export function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** "320 × 48" size label. */
export function sizeText(r: Rect): string {
  return `${Math.round(r.w)} × ${Math.round(r.h)}`;
}

/** CSS length with at most two decimals (keeps transient style strings short and stable). */
export function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** Value for the CSS `translate` property. */
export function translateValue(dx: number, dy: number): string {
  return `${px(dx)} ${px(dy)}`;
}

/** Position label of a guide, e.g. "x 120". */
export function guideLabel(axis: "x" | "y", pos: number): string {
  return `${axis} ${Math.round(pos)}`;
}
