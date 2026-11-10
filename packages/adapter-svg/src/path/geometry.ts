import type { Point, Rect } from "@swarmloom/core";
import type { ArcSegment, PathSegment } from "./parse";

/**
 * 2D affine matrix in SVG order `[a, b, c, d, e, f]`:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
 */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const EPS = 1e-9;

/** Returns `m1 * m2` (apply `m2` first, then `m1`). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function applyToPoint(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Applies only the linear part (no translation), e.g. for offsets. */
export function applyToVector(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y };
}

export function determinant(m: Matrix): number {
  return m[0] * m[3] - m[1] * m[2];
}

/** Geometric mean scale factor, used to scale lengths such as stroke widths. */
export function meanScale(m: Matrix): number {
  return Math.sqrt(Math.abs(determinant(m)));
}

/** True when the matrix keeps axes aligned with positive scales (translate + scale only). */
export function isAxisAligned(m: Matrix): boolean {
  return Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && m[0] > 0 && m[3] > 0;
}

export function isFiniteMatrix(m: Matrix): boolean {
  return m.every(Number.isFinite);
}

/** Builds a Matrix from a DOMMatrix / SVGMatrix-like object. */
export function fromDomMatrix(dm: { a: number; b: number; c: number; d: number; e: number; f: number }): Matrix {
  return [dm.a, dm.b, dm.c, dm.d, dm.e, dm.f];
}

/** Matrix mapping the unit square onto `r` (objectBoundingBox units -> user space). */
export function rectToMatrix(r: Rect): Matrix {
  return [r.w, 0, 0, r.h, r.x, r.y];
}

/** Axis-aligned bounds of `r` after transforming its four corners. */
export function transformRect(m: Matrix, r: Rect): Rect {
  const b = new BoundsBuilder();
  for (const [x, y] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ] as const) {
    const p = applyToPoint(m, x, y);
    b.add(p.x, p.y);
  }
  return b.rect() ?? { x: 0, y: 0, w: 0, h: 0 };
}

export interface Decomposed {
  /** Scale along the transformed x and y axes (sy is negative for reflections). */
  sx: number;
  sy: number;
  /** Rotation in degrees. */
  rotation: number;
}

/** Decomposes the linear part into rotation and scale (skew is folded into `sy`). */
export function decompose(m: Matrix): Decomposed {
  const [a, b, c, d] = m;
  const sx = Math.hypot(a, b);
  const rotation = sx > EPS ? (Math.atan2(b, a) * 180) / Math.PI : 0;
  const sy = sx > EPS ? (a * d - b * c) / sx : Math.hypot(c, d);
  return { sx, sy, rotation };
}

/**
 * Places a user-space rect in stage space for HTML-rendered layers. Axis-aligned transforms give
 * the exact box; rotated ones keep the unrotated size around the transformed centre plus a CSS
 * rotation (applied around the box centre, as LayerBase.transform specifies).
 */
export function placeRect(rect: Rect, m: Matrix): { box: Rect; transform?: string } {
  if (isAxisAligned(m)) return { box: transformRect(m, rect) };
  const { sx, sy, rotation } = decompose(m);
  const c = applyToPoint(m, rect.x + rect.w / 2, rect.y + rect.h / 2);
  const w = rect.w * sx;
  const h = rect.h * Math.abs(sy);
  const rotate = `rotate(${formatNumber(rotation, 3)}deg)`;
  return { box: { x: c.x - w / 2, y: c.y - h / 2, w, h }, transform: sy < 0 ? `${rotate} scaleY(-1)` : rotate };
}

/** Serialises a matrix for SVG `transform` attributes. */
export function matrixToString(m: Matrix): string {
  return `matrix(${m.map((v) => formatNumber(v, 6)).join(" ")})`;
}

/** Short stable key for caches. */
export function matrixKey(m: Matrix): string {
  return m.map((v) => formatNumber(v, 4)).join(",");
}

/** Formats a number with at most `precision` decimals, no trailing zeros and no "-0". */
export function formatNumber(v: number, precision = 2): string {
  if (!Number.isFinite(v)) return "0";
  const f = 10 ** precision;
  const r = Math.round(v * f) / f;
  if (r === 0) return "0";
  return String(r);
}

/* ------------------------------------------------------------------ */
/* Transforming segments                                               */
/* ------------------------------------------------------------------ */

/**
 * Transforms an elliptical arc by an affine matrix. The image of an ellipse under an affine map is
 * an ellipse: its radii are the singular values of `A * R(phi) * diag(rx, ry)` and its rotation is the
 * direction of the major axis. Reflections flip the sweep flag.
 */
function transformArc(seg: ArcSegment, m: Matrix): PathSegment {
  const end = applyToPoint(m, seg.x, seg.y);
  const phi = (seg.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // Columns of M0 = R(phi) * diag(rx, ry).
  const m00 = cos * seg.rx;
  const m10 = sin * seg.rx;
  const m01 = -sin * seg.ry;
  const m11 = cos * seg.ry;
  // M = A * M0 with A = [[a, c], [b, d]].
  const [a, b, c, d] = m;
  const n00 = a * m00 + c * m10;
  const n10 = b * m00 + d * m10;
  const n01 = a * m01 + c * m11;
  const n11 = b * m01 + d * m11;
  // S = M * M^T (symmetric); its eigen decomposition gives the new axes.
  const p = n00 * n00 + n01 * n01;
  const q = n00 * n10 + n01 * n11;
  const r = n10 * n10 + n11 * n11;
  const mean = (p + r) / 2;
  const root = Math.hypot((p - r) / 2, q);
  const rx = Math.sqrt(Math.max(0, mean + root));
  const ry = Math.sqrt(Math.max(0, mean - root));
  if (ry < 1e-7 || rx < 1e-7) return { type: "L", x: end.x, y: end.y };
  const rotation = root < 1e-12 ? 0 : (0.5 * Math.atan2(2 * q, p - r) * 180) / Math.PI;
  const sweep = determinant(m) < 0 ? !seg.sweep : seg.sweep;
  return { type: "A", rx, ry, rotation, largeArc: seg.largeArc, sweep, x: end.x, y: end.y };
}

/** Applies an affine matrix to every segment (exact for lines, curves and arcs). */
export function transformSegments(segments: readonly PathSegment[], m: Matrix): PathSegment[] {
  return segments.map((s): PathSegment => {
    switch (s.type) {
      case "M":
      case "L": {
        const p = applyToPoint(m, s.x, s.y);
        return { type: s.type, x: p.x, y: p.y };
      }
      case "C": {
        const p1 = applyToPoint(m, s.x1, s.y1);
        const p2 = applyToPoint(m, s.x2, s.y2);
        const p = applyToPoint(m, s.x, s.y);
        return { type: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      case "Q": {
        const p1 = applyToPoint(m, s.x1, s.y1);
        const p = applyToPoint(m, s.x, s.y);
        return { type: "Q", x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      case "A":
        return transformArc(s, m);
      default:
        // "Z" carries no coordinates.
        return s;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/** Incremental axis-aligned bounds. */
export class BoundsBuilder {
  private x0 = Number.POSITIVE_INFINITY;
  private y0 = Number.POSITIVE_INFINITY;
  private x1 = Number.NEGATIVE_INFINITY;
  private y1 = Number.NEGATIVE_INFINITY;

  add(x: number, y: number): void {
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x > this.x1) this.x1 = x;
    if (y > this.y1) this.y1 = y;
  }

  get empty(): boolean {
    return !(this.x1 >= this.x0 && this.y1 >= this.y0);
  }

  rect(): Rect | null {
    if (this.empty) return null;
    return { x: this.x0, y: this.y0, w: this.x1 - this.x0, h: this.y1 - this.y0 };
  }
}

/** Parameters where a 1D cubic Bezier has a local extremum (callers keep those in (0, 1)). */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number, out: number[]): void {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) > EPS) out.push(-c / b);
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const sq = Math.sqrt(disc);
  out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function quadAt(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

export interface ArcCenter {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phi: number;
  /** Start angle and signed sweep in radians (parametric angles). */
  theta: number;
  delta: number;
}

/** Endpoint to centre parameterisation (SVG 2, B.2.4) including out-of-range radii correction. */
export function arcToCenter(x0: number, y0: number, seg: ArcSegment): ArcCenter | null {
  const { x, y, largeArc, sweep } = seg;
  if (Math.abs(x - x0) < EPS && Math.abs(y - y0) < EPS) return null;
  let rx = Math.abs(seg.rx);
  let ry = Math.abs(seg.ry);
  const phi = (seg.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den > 0 ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta, delta };
}

function arcPoint(c: ArcCenter, t: number): Point {
  const cos = Math.cos(c.phi);
  const sin = Math.sin(c.phi);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return { x: c.cx + c.rx * cos * ct - c.ry * sin * st, y: c.cy + c.rx * sin * ct + c.ry * cos * st };
}

/** True when parametric angle `t` lies on the arc swept from `theta` by `delta`. */
function onArc(c: ArcCenter, t: number): boolean {
  const twoPi = 2 * Math.PI;
  let rel = (t - c.theta) % twoPi;
  if (c.delta >= 0) {
    if (rel < 0) rel += twoPi;
    return rel <= c.delta;
  }
  if (rel > 0) rel -= twoPi;
  return rel >= c.delta;
}

function addArcBounds(b: BoundsBuilder, x0: number, y0: number, seg: ArcSegment): void {
  b.add(seg.x, seg.y);
  const c = arcToCenter(x0, y0, seg);
  if (!c) return;
  const cos = Math.cos(c.phi);
  const sin = Math.sin(c.phi);
  // dx/dt = 0 and dy/dt = 0 give the axis extremes of the rotated ellipse.
  const tx = Math.atan2(-c.ry * sin, c.rx * cos);
  const ty = Math.atan2(c.ry * cos, c.rx * sin);
  for (const t of [tx, tx + Math.PI, ty, ty + Math.PI]) {
    if (onArc(c, t)) {
      const p = arcPoint(c, t);
      b.add(p.x, p.y);
    }
  }
}

/** Exact geometric bounds of a path (control points excluded). Null for empty paths. */
export function pathBounds(segments: readonly PathSegment[]): Rect | null {
  const b = new BoundsBuilder();
  const ts: number[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const s of segments) {
    switch (s.type) {
      case "M":
        sx = s.x;
        sy = s.y;
        x = sx;
        y = sy;
        b.add(x, y);
        break;
      case "L":
        b.add(s.x, s.y);
        x = s.x;
        y = s.y;
        break;
      case "C": {
        b.add(s.x, s.y);
        ts.length = 0;
        cubicExtrema(x, s.x1, s.x2, s.x, ts);
        cubicExtrema(y, s.y1, s.y2, s.y, ts);
        for (const t of ts) {
          if (t > 0 && t < 1) b.add(cubicAt(x, s.x1, s.x2, s.x, t), cubicAt(y, s.y1, s.y2, s.y, t));
        }
        x = s.x;
        y = s.y;
        break;
      }
      case "Q": {
        b.add(s.x, s.y);
        for (const [p0, p1, p2] of [
          [x, s.x1, s.x],
          [y, s.y1, s.y],
        ] as const) {
          const den = p0 - 2 * p1 + p2;
          if (Math.abs(den) > EPS) {
            const t = (p0 - p1) / den;
            if (t > 0 && t < 1) b.add(quadAt(x, s.x1, s.x, t), quadAt(y, s.y1, s.y, t));
          }
        }
        x = s.x;
        y = s.y;
        break;
      }
      case "A":
        addArcBounds(b, x, y, s);
        x = s.x;
        y = s.y;
        break;
      case "Z":
        x = sx;
        y = sy;
        break;
    }
  }
  return b.rect();
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

/** Serialises absolute segments to compact path data. */
export function serializePath(segments: readonly PathSegment[], precision = 2): string {
  const n = (v: number): string => formatNumber(v, precision);
  const parts: string[] = [];
  for (const s of segments) {
    switch (s.type) {
      case "M":
      case "L":
        parts.push(`${s.type}${n(s.x)} ${n(s.y)}`);
        break;
      case "C":
        parts.push(`C${n(s.x1)} ${n(s.y1)} ${n(s.x2)} ${n(s.y2)} ${n(s.x)} ${n(s.y)}`);
        break;
      case "Q":
        parts.push(`Q${n(s.x1)} ${n(s.y1)} ${n(s.x)} ${n(s.y)}`);
        break;
      case "A":
        parts.push(
          `A${n(s.rx)} ${n(s.ry)} ${n(s.rotation)} ${s.largeArc ? 1 : 0} ${s.sweep ? 1 : 0} ${n(s.x)} ${n(s.y)}`,
        );
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join("");
}
