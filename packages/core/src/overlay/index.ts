import { type BubbleChrome, CursorPainter } from "../cursor";
import type { AgentView, ResolvedTheme } from "../internal";
import type { OverlayHandle, OverlayLevel } from "../types";
import { type GuideLine, type OverlayRecord, PAINTERS, type PaintEnv, paintGuideLines, RANKS } from "./kinds";
import type { Props } from "./props";
import { RULER_SIZE, Rulers } from "./rulers";
import { deriveTokens, type Tokens } from "./tokens";
import { createViewTransform, type ViewTransform } from "./view";

export type { GuideLine, OverlayRecord, PaintEnv } from "./kinds";
export { RULER_SIZE } from "./rulers";
export { deriveTokens, type Tokens } from "./tokens";
export { createViewTransform, type ViewTransform } from "./view";

/** Rank for kinds the stage does not draw (plugin-defined strings). */
const UNKNOWN_RANK = 50;
/** Hard cap so a runaway choreography cannot grow the overlay list without bound. */
const MAX_OVERLAYS = 4096;
/** Canvas backing stores above this many device pixels get a lower effective DPR. */
const MAX_CANVAS_PIXELS = 16_777_216;

interface ImageEntry {
  readonly img: HTMLImageElement;
  ok: boolean;
  readonly settled: Promise<void>;
}

const NOOP_HANDLE: OverlayHandle = { update() {}, remove() {} };

const MEASURING_KINDS = ["size-badge", "measure", "guide"];
/** Overlay kinds left out per {@link OverlayLevel}; "full" also draws guide lines and rulers. */
const HIDDEN_KINDS: Readonly<Record<OverlayLevel, ReadonlySet<string>>> = {
  full: new Set(),
  minimal: new Set(MEASURING_KINDS),
  none: new Set([...MEASURING_KINDS, "selection", "ghost-rect", "rubber-band", "anchor", "caret"]),
};

/**
 * The single DPR-aware canvas above the content: blueprint guide layers, transient overlays,
 * rulers and the swarm, repainted once per render(). Nothing is drawn (and nothing cleared
 * twice) while there is nothing to show.
 */
export class OverlayLayer {
  readonly view: ViewTransform = createViewTransform();
  readonly tokens: Tokens;
  /** Guide-layer lines for this frame; the stage fills the first `guideCount` entries. */
  readonly guides: GuideLine[] = [];
  guideCount = 0;

  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D | null;
  readonly #rulers: Rulers;
  readonly #cursors: CursorPainter;
  readonly #env: PaintEnv;
  readonly #records: OverlayRecord[] = [];
  readonly #images = new Map<string, ImageEntry>();
  readonly #level: OverlayLevel;
  #seq = 0;
  #hidden = false;
  #dirty = true;
  #lastNow = Number.NaN;

  /** `level` picks the editing marks drawn (see {@link OverlayLevel}); cursors and name tags always are. */
  constructor(canvas: HTMLCanvasElement, theme: ResolvedTheme, reducedMotion: boolean, level: OverlayLevel = "full") {
    const doc = canvas.ownerDocument;
    this.#canvas = canvas;
    this.#level = HIDDEN_KINDS[level] ? level : "full";
    this.#ctx = canvas.getContext("2d");
    this.tokens = deriveTokens(theme);
    this.#rulers = new Rulers(doc, this.tokens);
    const bubble: BubbleChrome = {
      bg: this.tokens.chromeBg,
      fg: this.tokens.chromeFg,
      border: this.tokens.chromeLine,
    };
    this.#cursors = new CursorPainter(doc, bubble, reducedMotion);
    this.#env = {
      doc,
      tokens: this.tokens,
      reducedMotion,
      rulerInset: 0,
      image: (src) => this.#image(src),
    };
  }

  /** Number of live overlays. */
  get size(): number {
    return this.#records.length;
  }

  /** Creates a transient overlay; `props` are copied and later merged by update(). */
  add(kind: string, props: Props): OverlayHandle {
    if (typeof kind !== "string" || this.#records.length >= MAX_OVERLAYS) return NOOP_HANDLE;
    const rec: OverlayRecord = {
      kind,
      rank: RANKS[kind] ?? UNKNOWN_RANK,
      seq: this.#seq++,
      props: Object.assign({}, isObject(props) ? props : null),
      alive: true,
      changedAt: Number.NaN,
      changed: true,
      labels: [null, null],
      labelText: ["", ""],
      labelBg: ["", ""],
      labelNum: [Number.NaN, Number.NaN],
      labelDpr: 0,
    };
    const list = this.#records;
    let i = list.length;
    while (i > 0 && (list[i - 1]?.rank ?? 0) > rec.rank) i--;
    list.splice(i, 0, rec);
    return {
      update: (next) => {
        if (!rec.alive || !isObject(next)) return;
        Object.assign(rec.props, next);
        rec.changed = true;
      },
      remove: () => this.#remove(rec),
    };
  }

  /** Removes every overlay (reset/teardown); handles held by callers become no-ops. */
  clearOverlays(): void {
    for (const rec of this.#records) rec.alive = false;
    this.#records.length = 0;
    this.guideCount = 0;
  }

  /** Hides cursors and overlays (inline go-live) or shows them again. */
  setHidden(hidden: boolean): void {
    this.#hidden = hidden;
  }

  setRulers(on: boolean, instant: boolean): void {
    this.#rulers.set(on, instant);
  }

  /** Space currently covered by the rulers along the top and left edges, CSS px. */
  get rulerInset(): number {
    return this.#level === "full" ? this.#rulers.visible * RULER_SIZE : 0;
  }

  /**
   * Matches the backing store to the visible viewport. Cheap when nothing changed; call
   * after the stage measured a resize (not every frame).
   */
  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(0, Math.round(width));
    const h = Math.max(0, Math.round(height));
    let d = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 4) : 1;
    if (w * h * d * d > MAX_CANVAS_PIXELS) d = Math.max(0.5, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, w * h)));
    const v = this.view;
    if (w === v.width && h === v.height && d === v.dpr) return;
    if (d !== v.dpr) this.#rulers.clear();
    v.width = w;
    v.height = h;
    v.dpr = d;
    this.#canvas.width = Math.max(1, Math.round(w * d));
    this.#canvas.height = Math.max(1, Math.round(h * d));
    this.#canvas.style.width = `${w}px`;
    this.#canvas.style.height = `${h}px`;
    this.#dirty = true;
  }

  /** Paints one frame. Returns the number of agents drawn. */
  render(now: number, agents: readonly AgentView[]): number {
    const dt = Number.isFinite(this.#lastNow) ? now - this.#lastNow : 0;
    this.#lastNow = now;
    const marks = this.#level === "full";
    const rulers = marks ? this.#rulers.step(dt) : 0;
    this.#env.rulerInset = rulers * RULER_SIZE;
    const ctx = this.#ctx;
    if (!ctx) return 0;
    const v = this.view;
    const guides = marks ? this.guideCount : 0;
    const busy = !this.#hidden && (this.#records.length > 0 || guides > 0 || agents.length > 0 || rulers > 0.001);
    if (!busy && !this.#dirty) return 0;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, v.width, v.height);
    this.#dirty = busy;
    if (!busy) return 0;

    paintGuideLines(ctx, this.guides, guides, v, this.#env);
    const hidden = HIDDEN_KINDS[this.#level];
    const list = this.#records;
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!rec || hidden.has(rec.kind)) continue;
      if (rec.changed || !Number.isFinite(rec.changedAt)) {
        rec.changed = false;
        rec.changedAt = now;
      }
      const paint = PAINTERS[rec.kind];
      if (!paint) continue;
      try {
        paint(ctx, rec, v, this.#env, now);
      } catch {
        // A malformed overlay must not break the frame; restore the shared state it may have left.
        ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }
    }
    if (marks) this.#rulers.draw(ctx, v, list, this.guides, this.guideCount);
    return this.#cursors.draw(ctx, agents, v, this.#level !== "none");
  }

  /** Settles when overlay images requested so far have loaded or failed. */
  imagesSettled(): Promise<void> {
    const all: Promise<void>[] = [];
    for (const e of this.#images.values()) all.push(e.settled);
    return Promise.all(all).then(() => undefined);
  }

  destroy(): void {
    this.clearOverlays();
    this.#cursors.clear();
    this.#rulers.clear();
    for (const e of this.#images.values()) e.img.src = "";
    this.#images.clear();
    this.#canvas.width = 1;
    this.#canvas.height = 1;
  }

  #remove(rec: OverlayRecord): void {
    if (!rec.alive) return;
    rec.alive = false;
    const i = this.#records.indexOf(rec);
    if (i >= 0) this.#records.splice(i, 1);
  }

  #image(src: string): HTMLImageElement | null {
    let e = this.#images.get(src);
    if (!e) {
      if (this.#images.size >= 32) return null;
      const img = this.#canvas.ownerDocument.createElement("img");
      img.decoding = "async";
      const entry: { img: HTMLImageElement; ok: boolean; settled: Promise<void> } = {
        img,
        ok: false,
        settled: Promise.resolve(),
      };
      entry.settled = new Promise<void>((resolve) => {
        img.onload = () => {
          entry.ok = img.naturalWidth > 0;
          resolve();
        };
        img.onerror = () => resolve();
      });
      img.src = src;
      this.#images.set(src, entry);
      e = entry;
    }
    return e.ok ? e.img : null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
