import { createSpriteCanvas, UI_FONT_STACK } from "../cursor/sprite";
import { crisp, type GuideLine, type OverlayRecord } from "./kinds";
import { num } from "./props";
import type { Tokens } from "./tokens";
import type { ViewTransform } from "./view";

/** Ruler thickness, CSS px. */
export const RULER_SIZE = 20;
const SLIDE_MS = 180;
const RULER_FONT = `500 9px ${UI_FONT_STACK}`;
/** Candidate label spacings in stage px; the first giving >= 64 CSS px between labels wins. */
const STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Figma-like rulers along the top and left edges. Tick tiles are re-rendered only when the
 * scroll offset, scale or size changes; selection ranges and guide marks are drawn live on top.
 */
export class Rulers {
  readonly #doc: Document;
  readonly #tokens: Tokens;
  #t = 0;
  #target = 0;
  #top: Tile | null = null;
  #left: Tile | null = null;
  #kOrigin = Number.NaN;
  #kOriginY = Number.NaN;
  #kScale = 0;
  #kW = 0;
  #kH = 0;
  #kDpr = 0;

  constructor(doc: Document, tokens: Tokens) {
    this.#doc = doc;
    this.#tokens = tokens;
  }

  /** Show or hide; `instant` skips the slide (reduced motion). */
  set(on: boolean, instant: boolean): void {
    this.#target = on ? 1 : 0;
    if (instant) this.#t = this.#target;
  }

  /** Advances the slide by `dt` ms and returns the eased visibility (0 hidden .. 1 shown). */
  step(dt: number): number {
    if (this.#t !== this.#target) {
      const d = dt > 0 && Number.isFinite(dt) ? dt / SLIDE_MS : 1;
      this.#t = this.#target > this.#t ? Math.min(this.#target, this.#t + d) : Math.max(this.#target, this.#t - d);
    }
    return this.visible;
  }

  /** Eased visibility. */
  get visible(): number {
    const u = 1 - this.#t;
    return 1 - u * u * u;
  }

  /** True while the slide animation still needs frames. */
  get animating(): boolean {
    return this.#t !== this.#target;
  }

  /** Drops cached tiles (teardown or DPR change). */
  clear(): void {
    this.#top = null;
    this.#left = null;
    this.#kDpr = 0;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    v: ViewTransform,
    records: readonly OverlayRecord[],
    guides: readonly GuideLine[],
    guideCount: number,
  ): void {
    const e = this.visible;
    if (e <= 0.001) return;
    this.#ensureTiles(v);
    const top = this.#top;
    const left = this.#left;
    if (!top || !left) return;
    const off = (1 - e) * RULER_SIZE;
    const tk = this.#tokens;
    ctx.drawImage(top.canvas, 0, -off, v.width, RULER_SIZE);
    ctx.drawImage(left.canvas, -off, 0, RULER_SIZE, v.height);

    // Live marks: selections as tinted ranges, guides as accent ticks.
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r?.alive) continue;
      if (r.kind === "selection") {
        const p = r.props;
        const x = v.originX + num(p, "x", 0) * v.scale;
        const y = v.originY + num(p, "y", 0) * v.scale;
        const w = num(p, "w", 0) * v.scale;
        const h = num(p, "h", 0) * v.scale;
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = tk.select;
        ctx.fillRect(Math.max(RULER_SIZE, Math.min(x, x + w)), -off, Math.abs(w), RULER_SIZE);
        ctx.fillRect(-off, Math.max(RULER_SIZE, Math.min(y, y + h)), RULER_SIZE, Math.abs(h));
        ctx.globalAlpha = 1;
      } else if (r.kind === "guide") {
        const pos = num(r.props, "pos", Number.NaN);
        if (Number.isFinite(pos)) this.#mark(ctx, v, r.props.axis === "y" ? "y" : "x", pos, off);
      }
    }
    for (let i = 0; i < guideCount; i++) {
      const g = guides[i];
      if (g && g.alpha > 0.004) {
        ctx.globalAlpha = g.alpha;
        this.#mark(ctx, v, g.axis, g.pos, off);
      }
    }
    ctx.globalAlpha = 1;

    // Corner square with a small woven mark.
    const c = RULER_SIZE - off;
    ctx.fillStyle = tk.chromeBg;
    ctx.fillRect(0, 0, c, c);
    ctx.fillStyle = tk.chromeMuted;
    const m = c / 2;
    ctx.fillRect(m - 4, m - 3.5, 8, 1.5);
    ctx.fillRect(m - 4, m + 2, 8, 1.5);
    ctx.fillRect(m - 3.5, m - 4, 1.5, 8);
    ctx.fillRect(m + 2, m - 4, 1.5, 8);
    ctx.fillStyle = tk.chromeLine;
    ctx.fillRect(c - 1, 0, 1, c);
    ctx.fillRect(0, c - 1, c, 1);
  }

  #mark(ctx: CanvasRenderingContext2D, v: ViewTransform, axis: "x" | "y", pos: number, off: number): void {
    ctx.fillStyle = this.#tokens.accent;
    if (axis === "x") {
      const x = crisp(v.originX + pos * v.scale, v.dpr);
      if (x >= RULER_SIZE) ctx.fillRect(x - 1, -off, 2, RULER_SIZE);
    } else {
      const y = crisp(v.originY + pos * v.scale, v.dpr);
      if (y >= RULER_SIZE) ctx.fillRect(-off, y - 1, RULER_SIZE, 2);
    }
  }

  #ensureTiles(v: ViewTransform): void {
    const resized = v.width !== this.#kW || v.height !== this.#kH || v.dpr !== this.#kDpr;
    if (resized || !this.#top || !this.#left) {
      this.#top = createSpriteCanvas(this.#doc, Math.max(1, v.width), RULER_SIZE, v.dpr);
      this.#left = createSpriteCanvas(this.#doc, RULER_SIZE, Math.max(1, v.height), v.dpr);
      this.#kW = v.width;
      this.#kH = v.height;
      this.#kDpr = v.dpr;
      this.#kOrigin = Number.NaN;
      this.#kOriginY = Number.NaN;
    }
    if (v.scale !== this.#kScale) {
      this.#kScale = v.scale;
      this.#kOrigin = Number.NaN;
      this.#kOriginY = Number.NaN;
    }
    if (v.originX !== this.#kOrigin) {
      this.#kOrigin = v.originX;
      this.#paint(this.#top.ctx, v, true);
    }
    if (v.originY !== this.#kOriginY && this.#left) {
      this.#kOriginY = v.originY;
      this.#paint(this.#left.ctx, v, false);
    }
  }

  #paint(ctx: CanvasRenderingContext2D, v: ViewTransform, horizontal: boolean): void {
    const tk = this.#tokens;
    const length = horizontal ? v.width : v.height;
    const origin = horizontal ? v.originX : v.originY;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.clearRect(0, 0, horizontal ? length : RULER_SIZE, horizontal ? RULER_SIZE : length);
    ctx.fillStyle = tk.chromeBg;
    ctx.fillRect(0, 0, horizontal ? length : RULER_SIZE, horizontal ? RULER_SIZE : length);
    ctx.fillStyle = tk.chromeLine;
    if (horizontal) ctx.fillRect(0, RULER_SIZE - 1, length, 1);
    else ctx.fillRect(RULER_SIZE - 1, 0, 1, length);

    const scale = v.scale > 0 ? v.scale : 1;
    let step = STEPS[STEPS.length - 1] ?? 1000;
    for (const s of STEPS) {
      if (s * scale >= 64) {
        step = s;
        break;
      }
    }
    const minor = step / 10;
    const k0 = Math.floor((RULER_SIZE - origin) / scale / minor);
    const k1 = Math.ceil((length - origin) / scale / minor);
    ctx.font = RULER_FONT;
    ctx.textBaseline = "middle";
    for (let k = k0; k <= k1; k++) {
      const p = crisp(origin + k * minor * scale, v.dpr);
      if (p < RULER_SIZE) continue;
      const major = k % 10 === 0;
      const len = major ? 8 : k % 5 === 0 ? 5 : 3;
      ctx.fillStyle = major ? tk.chromeMuted : tk.chromeLine;
      if (horizontal) ctx.fillRect(p - 0.5, RULER_SIZE - 1 - len, 1, len);
      else ctx.fillRect(RULER_SIZE - 1 - len, p - 0.5, len, 1);
      if (!major) continue;
      ctx.fillStyle = tk.chromeMuted;
      const text = String(Math.round(k * minor));
      if (horizontal) {
        ctx.textAlign = "left";
        ctx.fillText(text, p + 3, 7);
      } else {
        ctx.save();
        ctx.translate(7, p + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "right";
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }
}
