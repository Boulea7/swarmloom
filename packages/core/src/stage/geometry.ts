import type { Point, Rect, Size } from "../types";

/** Inline stages never enlarge content more than this (small SVGs, icons). */
export const MAX_UPSCALE = 2;
const MIN_SCALE = 0.01;

/** Client-space origin of the scroller's visible area. */
export interface ClientOrigin {
  left: number;
  top: number;
}

/**
 * Scroll, scale and centring of the stage viewport. Pure arithmetic over cached values, so the
 * per-frame path never reads layout:
 *
 *   canvas/scroller-local CSS px = offset + stage px * scale - scroll
 *
 * Overlay stages map 1:1 onto the page (scale 1, no centring). Inline stages fit the world to the
 * container width; content that is narrower or shorter than the container is centred, and small
 * content is enlarged (up to {@link MAX_UPSCALE}) only while it still fits vertically.
 */
export class Geometry {
  readonly worldW: number;
  readonly worldH: number;
  readonly #fit: boolean;
  clientW = 0;
  clientH = 0;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  /** Cached scroller scroll offsets, CSS px (updated from scroll events and programmatic scrolls). */
  scrollLeft = 0;
  scrollTop = 0;

  constructor(size: Size, fit: boolean) {
    this.worldW = size.w;
    this.worldH = size.h;
    this.#fit = fit;
  }

  /** Recomputes scale and centring for a visible client area; returns true when the scale changed. */
  layout(clientW: number, clientH: number): boolean {
    const w = Math.max(0, clientW);
    const h = Math.max(0, clientH);
    this.clientW = w;
    this.clientH = h;
    const prev = this.scale;
    if (this.#fit && w > 0) {
      let s = w / this.worldW;
      if (s > 1) s = Math.max(1, Math.min(s, MAX_UPSCALE, h > 0 ? h / this.worldH : 1));
      this.scale = Math.max(MIN_SCALE, s);
      this.offsetX = Math.max(0, (w - this.worldW * this.scale) / 2);
      this.offsetY = Math.max(0, (h - this.worldH * this.scale) / 2);
    } else {
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
    }
    return this.scale !== prev;
  }

  /** Size of the scrollable extent (the sizer element), CSS px. */
  get extentW(): number {
    return Math.round(this.worldW * this.scale + this.offsetX * 2);
  }

  get extentH(): number {
    return Math.round(this.worldH * this.scale + this.offsetY * 2);
  }

  get maxScrollTop(): number {
    return Math.max(0, this.extentH - this.clientH);
  }

  get maxScrollLeft(): number {
    return Math.max(0, this.extentW - this.clientW);
  }

  /** CSS transform of the world element: centring offset, then scale. */
  worldTransform(): string {
    const { offsetX: x, offsetY: y, scale: s } = this;
    if (x === 0 && y === 0 && s === 1) return "none";
    return `translate(${round3(x)}px,${round3(y)}px) scale(${s})`;
  }

  /** Visible area in stage coordinates, written into `out`. */
  viewport(out: Rect): Rect {
    const s = this.scale;
    out.x = (this.scrollLeft - this.offsetX) / s;
    out.y = (this.scrollTop - this.offsetY) / s;
    out.w = this.clientW / s;
    out.h = this.clientH / s;
    return out;
  }

  /** Scroller scrollTop that puts stage y at the top edge, clamped to the scroll range. */
  scrollTopFor(y: number): number {
    return clamp(y * this.scale + this.offsetY, 0, this.maxScrollTop);
  }

  scrollLeftFor(x: number): number {
    return clamp(x * this.scale + this.offsetX, 0, this.maxScrollLeft);
  }

  toClient(p: Point, origin: ClientOrigin): Point {
    const s = this.scale;
    return {
      x: origin.left + this.offsetX + p.x * s - this.scrollLeft,
      y: origin.top + this.offsetY + p.y * s - this.scrollTop,
    };
  }

  toStage(p: Point, origin: ClientOrigin): Point {
    const s = this.scale;
    return {
      x: (p.x - origin.left - this.offsetX + this.scrollLeft) / s,
      y: (p.y - origin.top - this.offsetY + this.scrollTop) / s,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Valid world size: Blueprint.size when finite and positive, else the extent of the layer boxes. */
export function worldSize(size: unknown, boxes: Iterable<Rect>, fallback: Size): Size {
  const s = size as Partial<Size> | null | undefined;
  if (s && isPositive(s.w) && isPositive(s.h)) return { w: s.w, h: s.h };
  let w = 0;
  let h = 0;
  for (const b of boxes) {
    w = Math.max(w, b.x + b.w);
    h = Math.max(h, b.y + b.h);
  }
  return { w: w > 0 ? w : fallback.w, h: h > 0 ? h : fallback.h };
}

function isPositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
