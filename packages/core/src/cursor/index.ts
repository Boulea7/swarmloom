import type { AgentView } from "../internal";
import type { ViewTransform } from "../overlay/view";
import { inkOn } from "../theme";
import { cursorSprite } from "./art";
import { ARROW_HEADING, shapeDef } from "./shapes";
import { type PillStyle, pillSprite, type Sprite, UI_FONT_STACK } from "./sprite";

export { cursorSprite } from "./art";
export { SHAPES, shapeDef } from "./shapes";
export type { PillStyle, Sprite } from "./sprite";
export { createSpriteCanvas, pillSprite, roundRectPath, UI_FONT_STACK } from "./sprite";

/** Colours for status bubbles, derived from the stage chrome. */
export interface BubbleChrome {
  bg: string;
  fg: string;
  border: string;
}

interface AgentCache {
  seen: number;
  label: string;
  color: string;
  tag: Sprite | null;
  bubble: string;
  bubbleSprite: Sprite | null;
}

/** Scale applied while the mouse button is held (around the hotspot). */
const PRESSED_SCALE = 0.86;
/** Agents further than this outside the canvas are skipped (tags extend right and below). */
const CULL_LEFT = 48;
const CULL_RIGHT = 220;
const MAX_TILT = 0.32;
/** Forget caches of agents not drawn for this many frames. */
const PRUNE_AFTER = 180;

const TAG_FONT = `600 11px ${UI_FONT_STACK}`;
const BUBBLE_FONT = `500 11px ${UI_FONT_STACK}`;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Gap between the hotspot and a name tag flipped to its left or above it, CSS px at scale 1. */
const FLIP_GAP = 4;

/**
 * Top-left corner of a cursor's name tag, CSS px. The tag sits at `offset` from the hotspot
 * (below right); where it would cross the right or bottom edge of the `width` x `height` canvas it
 * flips to the hotspot's left or above it, then it is kept inside the canvas. Depends only on the
 * arguments, so the same cursor path places tags the same way in every run.
 */
export function tagOrigin(
  cx: number,
  cy: number,
  offset: { x: number; y: number },
  size: number,
  tag: { w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number } {
  let x = cx + offset.x * size;
  if (x + tag.w > width) x = cx - FLIP_GAP * size - tag.w;
  let y = cy + offset.y * size;
  if (y + tag.h > height) y = cy - FLIP_GAP * size - tag.h;
  return { x: Math.max(0, Math.min(x, width - tag.w)), y: Math.max(0, Math.min(y, height - tag.h)) };
}

/** Wraps an angle to (-PI, PI]. */
function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
}

/**
 * Draws the swarm: cursor art, name tags and status bubbles. Sprites are cached per colour, shape
 * and device pixel ratio; tags and bubbles per agent. The per-frame loop only does arithmetic,
 * Map lookups and drawImage calls.
 */
export class CursorPainter {
  readonly #doc: Document;
  readonly #bubble: BubbleChrome;
  readonly #tilt: boolean;
  readonly #cursors = new Map<string, Map<string, Sprite>>();
  readonly #agents = new Map<number, AgentCache>();
  #dpr = 0;
  #frame = 0;

  constructor(doc: Document, bubble: BubbleChrome, reducedMotion: boolean) {
    this.#doc = doc;
    this.#bubble = bubble;
    this.#tilt = !reducedMotion;
  }

  /** Drops every cached bitmap (device pixel ratio changed, or teardown). */
  clear(): void {
    this.#cursors.clear();
    this.#agents.clear();
  }

  /** Draws visible agents (with their status bubbles unless `bubbles` is false); returns how many were drawn. */
  draw(ctx: CanvasRenderingContext2D, agents: readonly AgentView[], view: ViewTransform, bubbles = true): number {
    const dpr = view.dpr;
    if (dpr !== this.#dpr) {
      this.clear();
      this.#dpr = dpr;
    }
    const frame = ++this.#frame;
    let drawn = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a || !(a.alpha > 0.004)) continue;
      const cx = view.originX + a.x * view.scale;
      const cy = view.originY + a.y * view.scale;
      if (!(cx > -CULL_LEFT && cy > -CULL_LEFT && cx < view.width + CULL_RIGHT && cy < view.height + CULL_LEFT)) {
        continue; // also rejects NaN
      }
      const def = shapeDef(a.shape);
      const sprite = this.#cursor(a.color, a.shape);
      const size = clamp(Number.isFinite(a.scale) ? a.scale : 1, 0, 4);
      const s = size * (a.pressed ? PRESSED_SCALE : 1);
      ctx.globalAlpha = Math.min(a.alpha, 1);
      let tilt = 0;
      if (this.#tilt && def.tilts && typeof a.angle === "number" && Number.isFinite(a.angle)) {
        tilt = clamp(wrapAngle(a.angle - ARROW_HEADING) * 0.12, -MAX_TILT, MAX_TILT);
      }
      if (tilt !== 0) {
        const c = Math.cos(tilt) * dpr;
        const sn = Math.sin(tilt) * dpr;
        ctx.setTransform(c, sn, -sn, c, cx * dpr, cy * dpr);
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, cx * dpr, cy * dpr);
      }
      ctx.drawImage(sprite.canvas, -sprite.ax * s, -sprite.ay * s, sprite.w * s, sprite.h * s);

      const cache = this.#agentCache(a, frame);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (cache.tag) {
        const at = tagOrigin(cx, cy, def.tag, size, cache.tag, view.width, view.height);
        const tx = Math.round(at.x * dpr) / dpr;
        const ty = Math.round(at.y * dpr) / dpr;
        ctx.drawImage(cache.tag.canvas, tx, ty, cache.tag.w, cache.tag.h);
      }
      if (bubbles && cache.bubbleSprite) {
        const b = cache.bubbleSprite;
        const bx = Math.round((cx + 6 - b.ax) * dpr) / dpr;
        const by = Math.round((cy - 6 - b.ay) * dpr) / dpr;
        ctx.drawImage(b.canvas, bx, by, b.w, b.h);
      }
      drawn++;
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (frame % PRUNE_AFTER === 0) this.#prune(frame);
    return drawn;
  }

  #cursor(color: string, shape: string): Sprite {
    let byShape = this.#cursors.get(color);
    if (!byShape) {
      byShape = new Map();
      this.#cursors.set(color, byShape);
    }
    let sprite = byShape.get(shape);
    if (!sprite) {
      sprite = cursorSprite(this.#doc, shape, color, this.#dpr);
      byShape.set(shape, sprite);
    }
    return sprite;
  }

  #agentCache(a: AgentView, frame: number): AgentCache {
    let c = this.#agents.get(a.id);
    if (!c) {
      c = { seen: frame, label: "", color: "", tag: null, bubble: "", bubbleSprite: null };
      this.#agents.set(a.id, c);
    }
    c.seen = frame;
    const label = typeof a.label === "string" ? a.label : "";
    if (label !== c.label || a.color !== c.color) {
      c.label = label;
      c.color = a.color;
      c.tag = label ? pillSprite(this.#doc, this.#dpr, label, this.#tagStyle(a.color)) : null;
    }
    const bubble = typeof a.bubble === "string" ? a.bubble : "";
    if (bubble !== c.bubble) {
      c.bubble = bubble;
      c.bubbleSprite = bubble ? pillSprite(this.#doc, this.#dpr, bubble, this.#bubbleStyle()) : null;
    }
    return c;
  }

  #tagStyle(color: string): PillStyle {
    return {
      font: TAG_FONT,
      height: 18,
      padX: 6,
      radius: 6,
      bg: color,
      fg: inkOn(color),
      highlight: true,
      maxWidth: 160,
    };
  }

  #bubbleStyle(): PillStyle {
    const b = this.#bubble;
    return {
      font: BUBBLE_FONT,
      height: 20,
      padX: 8,
      radius: 8,
      bg: b.bg,
      fg: b.fg,
      border: b.border,
      maxWidth: 200,
      tail: true,
    };
  }

  #prune(frame: number): void {
    for (const [id, c] of this.#agents) if (frame - c.seen > PRUNE_AFTER) this.#agents.delete(id);
  }
}
