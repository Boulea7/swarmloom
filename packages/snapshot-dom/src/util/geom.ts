import type { Rect } from "@swarmloom/core";

/** Rounds to 1/100 px: enough for layout fidelity, compact in JSON. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function roundRect(r: Rect): Rect {
  return { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
}

/**
 * Rounds outwards to 1/100 px so the result always contains `r`.
 * Text boxes use it: a box narrower than the original by a fraction of a pixel can change line breaks.
 */
export function outwardRect(r: Rect): Rect {
  const x = Math.floor(r.x * 100) / 100;
  const y = Math.floor(r.y * 100) / 100;
  const right = Math.ceil((r.x + r.w) * 100) / 100;
  const bottom = Math.ceil((r.y + r.h) * 100) / 100;
  return { x, y, w: round2(right - x), h: round2(bottom - y) };
}

/** Intersection with strictly positive area, or null. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right - x <= 0 || bottom - y <= 0) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/** Like {@link intersect} but keeps zero-height/zero-width overlaps (thin lines). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function contains(outer: Rect, inner: Rect, eps = 0.5): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

export function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Shrinks a rect by per-side insets (top, right, bottom, left), never below zero size. */
export function inset(r: Rect, top: number, right: number, bottom: number, left: number): Rect {
  return { x: r.x + left, y: r.y + top, w: Math.max(0, r.w - left - right), h: Math.max(0, r.h - top - bottom) };
}

/** 2x2 linear part of a CSS transform: [a, b, c, d] as in matrix(a, b, c, d, e, f). */
export type Linear = readonly [number, number, number, number];

export function multiplyLinear(m: Linear, n: Linear): Linear {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3]];
}

export function isIdentity(m: Linear, eps = 1e-3): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps;
}

/**
 * Parses the linear part of a computed `transform` value (`none`, `matrix(...)` or `matrix3d(...)`).
 * 3D matrices are projected onto the screen plane, which is exact for 2D transforms written as 3D.
 */
export function parseLinear(value: string): Linear | null {
  if (!value || value === "none") return null;
  const open = value.indexOf("(");
  if (open < 0) return null;
  const nums = value
    .slice(open + 1, -1)
    .split(",")
    .map((s) => Number.parseFloat(s));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (value.startsWith("matrix3d") && nums.length === 16) {
    return [nums[0] as number, nums[1] as number, nums[4] as number, nums[5] as number];
  }
  if (value.startsWith("matrix") && nums.length === 6) {
    return [nums[0] as number, nums[1] as number, nums[2] as number, nums[3] as number];
  }
  return null;
}

export function linearToCss(m: Linear): string {
  const f = (v: number) => String(Math.round(v * 10000) / 10000);
  return `matrix(${f(m[0])}, ${f(m[1])}, ${f(m[2])}, ${f(m[3])}, 0, 0)`;
}
