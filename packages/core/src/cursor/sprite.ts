/**
 * Pre-rendered bitmaps for the cursor canvas. Text and vector art are rasterised once per
 * (content, colour, device pixel ratio) and blitted with drawImage every frame, which keeps
 * the per-frame path free of text shaping, path building and allocations.
 */

/** A bitmap drawn at device resolution; sizes and anchor are CSS px. */
export interface Sprite {
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
  /** Anchor (cursor hotspot, bubble tail tip) relative to the sprite's top-left, CSS px. */
  readonly ax: number;
  readonly ay: number;
}

/** System UI stack used for tags, badges and rulers (CJK-capable, no web font download). */
export const UI_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", ' +
  '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

/** Creates a canvas of `w` x `h` CSS px at `dpr`, with the context scaled to CSS px. */
export function createSpriteCanvas(
  doc: Document,
  w: number,
  h: number,
  dpr: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * dpr));
  canvas.height = Math.max(1, Math.ceil(h * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("SwarmLoom stage: 2D canvas context unavailable");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx };
}

/** Adds a rounded-rectangle sub-path (arcTo based, works where CanvasRenderingContext2D.roundRect does not). */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export interface PillStyle {
  /** Canvas font shorthand. */
  font: string;
  height: number;
  padX: number;
  radius: number;
  bg: string;
  fg: string;
  /** Optional 1px border colour. */
  border?: string;
  /** 1px inner highlight along the top edge (name tags). */
  highlight?: boolean;
  /** Text is ellipsised to fit this total width. */
  maxWidth: number;
  /** Speech-bubble tail under the left edge (status bubbles); the anchor becomes the tail tip. */
  tail?: boolean;
}

const ELLIPSIS = "…";
const TAIL = 5;

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(chars.slice(0, mid).join("") + ELLIPSIS).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("") + ELLIPSIS;
}

const probes = new WeakMap<Document, CanvasRenderingContext2D>();

/** Shared 1x1 context used only for text measurement. */
function probeFor(doc: Document): CanvasRenderingContext2D {
  let ctx = probes.get(doc);
  if (!ctx) {
    ctx = createSpriteCanvas(doc, 1, 1, 1).ctx;
    probes.set(doc, ctx);
  }
  return ctx;
}

/** Rasterises a single-line label in a rounded pill. The anchor is the top-left corner (or the tail tip). */
export function pillSprite(doc: Document, dpr: number, text: string, style: PillStyle): Sprite {
  const probe = probeFor(doc);
  probe.font = style.font;
  const label = fitText(probe, text, Math.max(8, style.maxWidth - style.padX * 2));
  const w = Math.ceil(probe.measureText(label).width + style.padX * 2);
  const h = style.height;
  const pad = 1;
  const totalH = h + pad * 2 + (style.tail ? TAIL : 0);
  const { canvas, ctx } = createSpriteCanvas(doc, w + pad * 2, totalH, dpr);
  ctx.translate(pad, pad);
  ctx.beginPath();
  roundRectPath(ctx, 0, 0, w, h, style.radius);
  if (style.tail) {
    ctx.moveTo(7, h - 0.5);
    ctx.lineTo(9, h + TAIL);
    ctx.lineTo(13, h - 0.5);
    ctx.closePath();
  }
  // An invalid colour leaves the previous fillStyle in place: preset the brand primary as fallback.
  ctx.fillStyle = "#5B5BF7";
  ctx.fillStyle = style.bg;
  ctx.fill();
  if (style.border) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = style.border;
    ctx.stroke();
  }
  if (style.highlight) {
    ctx.beginPath();
    ctx.moveTo(style.radius, 1);
    ctx.lineTo(w - style.radius, 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.stroke();
  }
  ctx.font = style.font;
  ctx.fillStyle = style.fg;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, style.padX, h / 2 + 0.5);
  return style.tail
    ? { canvas, w: w + pad * 2, h: totalH, ax: pad + 9, ay: pad + h + TAIL }
    : { canvas, w: w + pad * 2, h: totalH, ax: pad, ay: pad };
}
