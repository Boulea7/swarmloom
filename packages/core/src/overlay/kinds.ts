import { pillSprite, roundRectPath, type Sprite, UI_FONT_STACK } from "../cursor/sprite";
import { inkOn } from "../theme";
import type { Point, Rect } from "../types";
import { flag, isRect, num, numbers, type Props, str, strings } from "./props";
import type { Tokens } from "./tokens";
import type { ViewTransform } from "./view";

/** One live overlay created through StageApi.overlay(). */
export interface OverlayRecord {
  readonly kind: string;
  /** Paint order bucket (see RANKS); creation order breaks ties. */
  readonly rank: number;
  readonly seq: number;
  props: Props;
  alive: boolean;
  /** Engine time of the latest update (caret blink restarts on movement); NaN until first drawn. */
  changedAt: number;
  /** Set by update(); the next frame stamps `changedAt`. */
  changed: boolean;
  /** Cached label sprites (two slots: measure draws two gaps) and what they were built from. */
  labels: [Sprite | null, Sprite | null];
  labelText: [string, string];
  labelBg: [string, string];
  labelNum: [number, number];
  labelDpr: number;
}

/** A blueprint guide layer as the stage wants it drawn this frame. */
export interface GuideLine {
  /** "x": vertical line at x = pos (marks an x coordinate, like a Figma X guide); "y": horizontal line at y = pos. */
  axis: "x" | "y";
  pos: number;
  /** Drawn length 0..1 (slides out from the ruler while revealed). */
  len: number;
  alpha: number;
}

/** Shared, mutable paint context. */
export interface PaintEnv {
  readonly doc: Document;
  readonly tokens: Tokens;
  readonly reducedMotion: boolean;
  /** Ruler thickness currently covering the top/left edges (0 when hidden). */
  rulerInset: number;
  /** Loaded image for `src`, or null while loading / failed (loading starts on first call). */
  image(src: string): HTMLImageElement | null;
  /** Name tag boxes of this frame's cursors (CSS px); size badges keep clear of them. */
  tags: readonly Rect[];
}

/**
 * Paint order: lines and placeholders below, handles and labels above. Kinds missing here
 * (plugin-defined strings) are accepted but not drawn by the stage.
 */
export const RANKS: Readonly<Record<string, number>> = {
  guide: 0,
  measure: 1,
  "ghost-rect": 2,
  selection: 3,
  "rubber-band": 4,
  anchor: 5,
  caret: 6,
  "size-badge": 7,
  icon: 8,
  halo: 9,
};

const DASH = [4, 3];
const NO_DASH: number[] = [];
const LABEL_FONT = `600 11px ${UI_FONT_STACK}`;
const CARET_BLINK_MS = 530;
const HANDLE = 6;
const ANCHOR = 7;

const toX = (v: ViewTransform, x: number): number => v.originX + x * v.scale;
const toY = (v: ViewTransform, y: number): number => v.originY + y * v.scale;

/** Snaps a coordinate so a 1 CSS px line lands on whole device pixels. */
export function crisp(v: number, dpr: number): number {
  const off = Math.round(dpr) % 2 === 1 ? 0.5 : 0;
  return (Math.round(v * dpr - off) + off) / dpr;
}

function setStroke(ctx: CanvasRenderingContext2D, fallback: string, color: string | undefined): void {
  ctx.strokeStyle = fallback;
  if (color) ctx.strokeStyle = color;
}

function setFill(ctx: CanvasRenderingContext2D, fallback: string, color: string | undefined): void {
  ctx.fillStyle = fallback;
  if (color) ctx.fillStyle = color;
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, dpr: number): void {
  ctx.drawImage(s.canvas, Math.round(x * dpr) / dpr, Math.round(y * dpr) / dpr, s.w, s.h);
}

function pill(env: PaintEnv, dpr: number, text: string, bg: string): Sprite {
  return pillSprite(env.doc, dpr, text, {
    font: LABEL_FONT,
    height: 18,
    padX: 6,
    radius: 5,
    bg,
    fg: inkOn(bg),
    maxWidth: 240,
  });
}

function textLabel(rec: OverlayRecord, slot: 0 | 1, env: PaintEnv, dpr: number, text: string, bg: string): Sprite {
  const cached = rec.labels[slot];
  if (cached && rec.labelDpr === dpr && rec.labelText[slot] === text && rec.labelBg[slot] === bg) return cached;
  if (rec.labelDpr !== dpr) {
    rec.labels[0] = null;
    rec.labels[1] = null;
    rec.labelDpr = dpr;
  }
  const s = pill(env, dpr, text, bg);
  rec.labels[slot] = s;
  rec.labelText[slot] = text;
  rec.labelBg[slot] = bg;
  return s;
}

/** Like textLabel for integer values: only formats a string when the number changes. */
function numberLabel(rec: OverlayRecord, slot: 0 | 1, env: PaintEnv, dpr: number, value: number, bg: string): Sprite {
  const cached = rec.labels[slot];
  if (cached && rec.labelDpr === dpr && rec.labelNum[slot] === value && rec.labelBg[slot] === bg) return cached;
  const s = textLabel(rec, slot, env, dpr, String(value), bg);
  rec.labelNum[slot] = value;
  return s;
}

type Painter = (
  ctx: CanvasRenderingContext2D,
  rec: OverlayRecord,
  v: ViewTransform,
  env: PaintEnv,
  now: number,
) => void;

const ghostRect: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  let x = toX(v, num(p, "x", 0));
  let y = toY(v, num(p, "y", 0));
  let w = num(p, "w", 0) * v.scale;
  let h = num(p, "h", 0) * v.scale;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  if (w < 0.5 && h < 0.5) return;
  const r = Math.max(0, num(p, "radius", 0)) * v.scale;
  const x0 = crisp(x, v.dpr);
  const y0 = crisp(y, v.dpr);
  ctx.beginPath();
  roundRectPath(ctx, x0, y0, Math.round(w), Math.round(h), r);
  if (flag(p, "fill", true)) {
    ctx.fillStyle = env.tokens.ghost;
    ctx.fill();
  }
  ctx.setLineDash(DASH);
  ctx.lineWidth = 1;
  setStroke(ctx, env.tokens.select, str(p, "color"));
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
};

/** Gap between a name tag and a size badge moved below it, CSS px. */
const BADGE_TAG_GAP = 2;

/**
 * Where a size badge goes: below right of its point, or clear of the name tag it would overlap there
 * (the dragging cursor's own tag sits at about the same spot): under the tag, or right of it when
 * there is no room under it above the canvas bottom `height`.
 */
export function badgeOrigin(
  x: number,
  y: number,
  badge: { w: number; h: number },
  tags: readonly Rect[],
  height: number,
): Point {
  const at = { x: x + 6, y: y + 6 };
  for (const t of tags) {
    if (at.x < t.x + t.w && t.x < at.x + badge.w && at.y < t.y + t.h && t.y < at.y + badge.h) {
      const below = t.y + t.h + BADGE_TAG_GAP;
      if (below + badge.h <= height) at.y = below;
      else at.x = t.x + t.w + BADGE_TAG_GAP;
    }
  }
  return at;
}

const sizeBadge: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  const text = str(p, "text");
  if (!text) return;
  const s = textLabel(rec, 0, env, v.dpr, text, str(p, "color") ?? env.tokens.select);
  const at = badgeOrigin(toX(v, num(p, "x", 0)), toY(v, num(p, "y", 0)), s, env.tags, v.height);
  blit(ctx, s, at.x, at.y, v.dpr);
};

const rubberBand: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  ctx.beginPath();
  ctx.moveTo(toX(v, num(p, "x1", 0)), toY(v, num(p, "y1", 0)));
  ctx.lineTo(toX(v, num(p, "x2", 0)), toY(v, num(p, "y2", 0)));
  ctx.lineWidth = 1.25;
  setStroke(ctx, env.tokens.select, str(p, "color"));
  ctx.stroke();
};

const anchor: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  const x = crisp(toX(v, num(p, "x", 0)) - ANCHOR / 2, v.dpr);
  const y = crisp(toY(v, num(p, "y", 0)) - ANCHOR / 2, v.dpr);
  const color = str(p, "color");
  if (flag(p, "active", false)) setFill(ctx, env.tokens.select, color);
  else ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, ANCHOR, ANCHOR);
  ctx.lineWidth = 1.5;
  setStroke(ctx, env.tokens.select, color);
  ctx.strokeRect(x, y, ANCHOR, ANCHOR);
};

function guideLine(
  ctx: CanvasRenderingContext2D,
  v: ViewTransform,
  axis: "x" | "y",
  pos: number,
  len: number,
  inset: number,
): void {
  ctx.beginPath();
  if (axis === "x") {
    const x = crisp(toX(v, pos), v.dpr);
    ctx.moveTo(x, inset);
    ctx.lineTo(x, inset + (v.height - inset) * len);
  } else {
    const y = crisp(toY(v, pos), v.dpr);
    ctx.moveTo(inset, y);
    ctx.lineTo(inset + (v.width - inset) * len, y);
  }
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Full-length ruler guide. `axis: "x"` is a vertical line at x = pos, `"y"` a horizontal line at y = pos. */
const guide: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  const axis = p.axis === "y" ? "y" : "x";
  const pos = num(p, "pos", Number.NaN);
  if (!Number.isFinite(pos)) return;
  const color = str(p, "color");
  setStroke(ctx, env.tokens.accent, color);
  guideLine(ctx, v, axis, pos, 1, env.rulerInset);
  const label = str(p, "label");
  if (!label) return;
  const s = textLabel(rec, 0, env, v.dpr, label, color ?? env.tokens.accent);
  if (axis === "x") blit(ctx, s, toX(v, pos) + 4, env.rulerInset + 4, v.dpr);
  else blit(ctx, s, env.rulerInset + 4, toY(v, pos) + 4, v.dpr);
};

/** Draws blueprint guide layers (lifetime handled by the stage). */
export function paintGuideLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly GuideLine[],
  count: number,
  v: ViewTransform,
  env: PaintEnv,
): void {
  if (count === 0) return;
  ctx.strokeStyle = env.tokens.accent;
  for (let i = 0; i < count; i++) {
    const g = lines[i];
    if (!g || g.alpha <= 0.004 || g.len <= 0) continue;
    ctx.globalAlpha = g.alpha;
    guideLine(ctx, v, g.axis, g.pos, g.len, env.rulerInset);
  }
  ctx.globalAlpha = 1;
}

const TICK = 4;

function gapLine(
  ctx: CanvasRenderingContext2D,
  horizontal: boolean,
  a: number,
  b: number,
  at: number,
  v: ViewTransform,
): void {
  ctx.beginPath();
  if (horizontal) {
    const y = crisp(toY(v, at), v.dpr);
    const x1 = toX(v, a);
    const x2 = toX(v, b);
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.moveTo(crisp(x1, v.dpr), y - TICK);
    ctx.lineTo(crisp(x1, v.dpr), y + TICK);
    ctx.moveTo(crisp(x2, v.dpr), y - TICK);
    ctx.lineTo(crisp(x2, v.dpr), y + TICK);
  } else {
    const x = crisp(toX(v, at), v.dpr);
    const y1 = toY(v, a);
    const y2 = toY(v, b);
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.moveTo(x - TICK, crisp(y1, v.dpr));
    ctx.lineTo(x + TICK, crisp(y1, v.dpr));
    ctx.moveTo(x - TICK, crisp(y2, v.dpr));
    ctx.lineTo(x + TICK, crisp(y2, v.dpr));
  }
  ctx.stroke();
}

/** Spacing between two rects: one horizontal and/or one vertical gap, each with a numeric label. */
const measure: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  const a = p.a;
  const b = p.b;
  if (!isRect(a) || !isRect(b)) return;
  const color = str(p, "color") ?? env.tokens.accent;
  setStroke(ctx, env.tokens.accent, color);
  ctx.lineWidth = 1;
  let gx1 = Number.NaN;
  let gx2 = Number.NaN;
  if (a.x + a.w <= b.x) {
    gx1 = a.x + a.w;
    gx2 = b.x;
  } else if (b.x + b.w <= a.x) {
    gx1 = b.x + b.w;
    gx2 = a.x;
  }
  if (gx2 > gx1) {
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    const ym = top < bottom ? (top + bottom) / 2 : (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    gapLine(ctx, true, gx1, gx2, ym, v);
    const s = numberLabel(rec, 0, env, v.dpr, Math.round(gx2 - gx1), color);
    blit(ctx, s, toX(v, (gx1 + gx2) / 2) - s.w / 2, toY(v, ym) + TICK + 3, v.dpr);
  }
  let gy1 = Number.NaN;
  let gy2 = Number.NaN;
  if (a.y + a.h <= b.y) {
    gy1 = a.y + a.h;
    gy2 = b.y;
  } else if (b.y + b.h <= a.y) {
    gy1 = b.y + b.h;
    gy2 = a.y;
  }
  if (gy2 > gy1) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const xm = left < right ? (left + right) / 2 : (a.x + a.w / 2 + b.x + b.w / 2) / 2;
    gapLine(ctx, false, gy1, gy2, xm, v);
    const s = numberLabel(rec, 1, env, v.dpr, Math.round(gy2 - gy1), color);
    blit(ctx, s, toX(v, xm) + TICK + 3, toY(v, (gy1 + gy2) / 2) - s.h / 2, v.dpr);
  }
};

const selection: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  let x = toX(v, num(p, "x", 0));
  let y = toY(v, num(p, "y", 0));
  let w = num(p, "w", 0) * v.scale;
  let h = num(p, "h", 0) * v.scale;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const color = str(p, "color");
  const x0 = crisp(x, v.dpr);
  const y0 = crisp(y, v.dpr);
  const x1 = crisp(x + w, v.dpr);
  const y1 = crisp(y + h, v.dpr);
  ctx.lineWidth = 1;
  setStroke(ctx, env.tokens.select, color);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  if (flag(p, "handles", false)) {
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 4; i++) {
      const hx = (i & 1 ? x1 : x0) - HANDLE / 2;
      const hy = (i & 2 ? y1 : y0) - HANDLE / 2;
      ctx.fillRect(hx, hy, HANDLE, HANDLE);
      ctx.strokeRect(hx, hy, HANDLE, HANDLE);
    }
  }
  const label = str(p, "label");
  if (label) {
    const s = textLabel(rec, 0, env, v.dpr, label, color ?? env.tokens.select);
    blit(ctx, s, x0 - 0.5, y0 - s.h - 3, v.dpr);
  }
};

/** Text caret; solid while it moves, then blinks on engine time (hard on/off like a real caret). */
const caret: Painter = (ctx, rec, v, env, now) => {
  const p = rec.props;
  const since = now - rec.changedAt;
  if (!env.reducedMotion && since > CARET_BLINK_MS && Math.floor(since / CARET_BLINK_MS) % 2 === 1) return;
  const h = num(p, "h", 16) * v.scale;
  setFill(ctx, env.tokens.select, str(p, "color"));
  ctx.fillRect(Math.round(toX(v, num(p, "x", 0)) * v.dpr) / v.dpr - 1, toY(v, num(p, "y", 0)), 2, h);
};

/** Small woven mark (two warp and two weft bars) used when no icon image is available. */
function loomGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const u = size / 6;
  ctx.fillStyle = color;
  ctx.globalAlpha *= 0.9;
  ctx.fillRect(x - 2 * u, y - 3 * u, u, 6 * u);
  ctx.fillRect(x + u, y - 3 * u, u, 6 * u);
  ctx.globalAlpha /= 0.9;
  ctx.fillRect(x - 3 * u, y - 2 * u, 6 * u, u);
  ctx.fillRect(x - 3 * u, y + u, 6 * u, u);
}

const icon: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  const alpha = Math.max(0, Math.min(1, num(p, "alpha", 1)));
  if (alpha <= 0.004) return;
  const x = toX(v, num(p, "x", 0));
  const y = toY(v, num(p, "y", 0));
  const size = Math.max(4, num(p, "size", 48) * v.scale);
  const src = str(p, "src");
  const img = src ? env.image(src) : null;
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.shadowColor = "rgba(11,11,18,0.18)";
  ctx.shadowBlur = 12 * v.dpr;
  ctx.shadowOffsetY = 2 * v.dpr;
  ctx.beginPath();
  roundRectPath(ctx, x - size * 0.6, y - size * 0.6, size * 1.2, size * 1.2, size * 0.32);
  ctx.fillStyle = env.tokens.chromeBg;
  ctx.fill();
  ctx.restore();
  if (img) ctx.drawImage(img, x - size * 0.4, y - size * 0.4, size * 0.8, size * 0.8);
  else loomGlyph(ctx, x, y, size * 0.6, env.tokens.select);
  ctx.globalAlpha = 1;
};

const HALO_POINTS = 96;

function sampleRing(bands: ArrayLike<number> | undefined, t: number): number {
  if (!bands || bands.length === 0) return 0;
  const n = bands.length;
  const f = t * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const k = f - Math.floor(f);
  const a = bands[i0] ?? 0;
  const b = bands[i1] ?? 0;
  const s = a + (b - a) * k;
  return Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 0;
}

/** Audio-reactive rings: each ring's radius is modulated around the circle by the band magnitudes. */
const halo: Painter = (ctx, rec, v, env) => {
  const p = rec.props;
  const x = toX(v, num(p, "x", 0));
  const y = toY(v, num(p, "y", 0));
  const r = Math.max(1, num(p, "r", 80) * v.scale);
  const level = Math.max(0, Math.min(1, num(p, "level", 0)));
  const bands = numbers(p, "bands");
  const colors = strings(p, "colors");
  const fade = Math.max(0, Math.min(1, num(p, "alpha", 1)));
  if (fade <= 0) return;
  const rings = colors ? Math.min(6, colors.length) : 3;
  ctx.save();
  ctx.lineJoin = "round";
  for (let i = 0; i < rings; i++) {
    const c = colors?.[i];
    const color = typeof c === "string" ? c : i % 2 === 0 ? env.tokens.select : env.tokens.accent;
    const base = r * (1 + i * 0.22) + level * r * 0.18;
    const amp = r * 0.14 * (1 - i * 0.12);
    const phase = i * 0.17;
    ctx.beginPath();
    for (let j = 0; j <= HALO_POINTS; j++) {
      const t = j / HALO_POINTS;
      const a = t * Math.PI * 2;
      const rr = base + sampleRing(bands, (t + phase) % 1) * amp;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = fade * Math.max(0.08, (0.78 - i * 0.14) * (0.45 + level * 0.55));
    ctx.lineWidth = Math.max(1, 2.4 - i * 0.3);
    ctx.shadowBlur = (4 + 18 * level) * v.dpr;
    setStroke(ctx, env.tokens.select, color);
    ctx.shadowColor = color;
    ctx.stroke();
  }
  ctx.restore();
};

export const PAINTERS: Readonly<Record<string, Painter>> = {
  guide,
  measure,
  "ghost-rect": ghostRect,
  selection,
  "rubber-band": rubberBand,
  anchor,
  caret,
  "size-badge": sizeBadge,
  icon,
  halo,
};
