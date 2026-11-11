import { BRAND } from "../theme";
import { type ShapeDef, shapeDef } from "./shapes";
import { createSpriteCanvas, type Sprite } from "./sprite";

/** Grid units of the shape art; 1 unit = 1 CSS px at scale 1. */
const GRID = 24;
/** Room around the art for the outline and the drop shadow. */
const PAD = 4;

const paths = new Map<string, Path2D>();

/** Path2D objects are built lazily (no DOM access at import time) and shared by every sprite. */
function path(d: string): Path2D {
  let p = paths.get(d);
  if (!p) {
    p = new Path2D(d);
    paths.set(d, p);
  }
  return p;
}

function paintShape(ctx: CanvasRenderingContext2D, def: ShapeDef, color: string, dpr: number): void {
  const body = def.body ? path(def.body) : null;
  const glyph = def.glyph ? path(def.glyph) : null;
  const rule: CanvasFillRule = def.evenOdd ? "evenodd" : "nonzero";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // White underlay with a soft shadow. Stroking before filling makes overlapping sub-paths read as one
  // silhouette: the inner halves of the strokes are painted over by the coloured fill.
  ctx.save();
  ctx.shadowColor = "rgba(11,11,18,0.34)";
  ctx.shadowBlur = 2.4 * dpr;
  ctx.shadowOffsetY = 0.8 * dpr;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  if (body) {
    ctx.lineWidth = 2.6;
    ctx.stroke(body);
  }
  if (glyph) {
    ctx.lineWidth = 4.4;
    ctx.stroke(glyph);
  }
  if (def.badge) {
    ctx.beginPath();
    ctx.arc(def.badge.x, def.badge.y, def.badge.r + 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Invalid colours are ignored by the canvas, so the brand primary stays as the fallback.
  ctx.fillStyle = BRAND.primary;
  ctx.fillStyle = color;
  ctx.strokeStyle = BRAND.primary;
  ctx.strokeStyle = color;
  if (body) ctx.fill(body, rule);
  if (glyph) {
    ctx.lineWidth = 1.8;
    ctx.stroke(glyph);
  }
  if (def.badge) {
    const { x, y, r } = def.badge;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, y);
    ctx.lineTo(x + r * 0.5, y);
    ctx.moveTo(x, y - r * 0.5);
    ctx.lineTo(x, y + r * 0.5);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  if (def.detail) {
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = "rgba(11,11,18,0.3)";
    ctx.stroke(path(def.detail));
  }
  if (def.highlight) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.stroke(path(def.highlight));
  }
}

/**
 * Rasterises one cursor shape in `color` at `dpr`. The sprite anchor is the shape's hotspot, so
 * drawing at (x - ax, y - ay) puts the tool tip exactly on the agent position.
 */
export function cursorSprite(doc: Document, shape: string, color: string, dpr: number): Sprite {
  const def = shapeDef(shape);
  const size = GRID + PAD * 2;
  const { canvas, ctx } = createSpriteCanvas(doc, size, size, dpr);
  ctx.translate(PAD, PAD);
  paintShape(ctx, def, color, dpr);
  return { canvas, w: size, h: size, ax: PAD + def.hot.x, ay: PAD + def.hot.y };
}
