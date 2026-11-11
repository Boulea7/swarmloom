import type { AgentView, Stage, StageOptions } from "../internal";
import { deriveTokens, OverlayLayer, type Tokens } from "../overlay";
import { BRAND } from "../theme";
import type { Blueprint, CSSMap, Layer, LayerRenderer, OverlayHandle, Plugin, Point, Rect } from "../types";
import { Fade } from "./fade";
import { type ClientOrigin, Geometry, worldSize } from "./geometry";
import { GuideLines } from "./guides";
import { buildDom, type StageDom } from "./host";
import { countTypingUnits, type GraphemeSegmenter, type MountEnv } from "./layers";
import { clamp01, reapplyStyleAttributes } from "./layers/common";
import { Mounter, type MountStats } from "./mounter";
import { PageGuard } from "./page";
import { LayerRegistry, type Slot } from "./registry";
import { FragmentCache } from "./sanitize";
import { ScrollController } from "./scroll";

/** Blank-canvas fade over the page (enter) and dissolve back to it (overlay go-live), engine ms. */
const ENTER_MS = 520;
const LIVE_MS = 520;
/** Reduced motion keeps the cross-fades (no movement) but shortens them. */
const REDUCED_FADE_MS = 200;
/** ready() never waits longer than this for images and fonts (wall clock: the engine clock may be paused). */
const READY_TIMEOUT_MS = 2500;
/** A virtualization pass runs when the view moved by this fraction of its height, and every N frames. */
const PASS_SCROLL_FRACTION = 0.2;
const PASS_EVERY_FRAMES = 30;
/**
 * Sanitized text markup kept for re-mounts (least recently used out). Above the mounter's keep-all
 * threshold, so small pages never parse a layer twice; on large pages it covers a few mount bands
 * instead of holding a DOM copy of every text layer ever mounted.
 */
const FRAGMENT_CACHE_LIMIT = 512;

const NOOP_HANDLE: OverlayHandle = { update() {}, remove() {} };
const NO_AGENTS: readonly AgentView[] = [];

function fail(message: string): never {
  throw new TypeError(`createStage: ${message}`);
}

/** Throws a TypeError naming the first invalid option. */
function validate(o: StageOptions): void {
  if (typeof o !== "object" || o === null) fail("options object required");
  const bp = o.blueprint as Blueprint | undefined;
  if (typeof bp !== "object" || bp === null || !Array.isArray(bp.layers))
    fail("blueprint with a layers array required");
  if (o.mode !== "overlay" && o.mode !== "inline") fail('mode must be "overlay" or "inline"');
  const host = o.host as HTMLElement | undefined;
  if (typeof host !== "object" || host === null || host.nodeType !== 1 || !host.ownerDocument?.defaultView) {
    fail("host must be an element of a document with a window");
  }
  if (typeof o.theme !== "object" || o.theme === null) fail("theme (ResolvedTheme) required");
  if (typeof o.rng !== "function") fail("rng function required");
  if (o.plugins !== undefined && !Array.isArray(o.plugins)) fail("plugins must be an array");
}

function createSegmenter(): GraphemeSegmenter | null {
  const Ctor = (
    Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: "grapheme" }) => GraphemeSegmenter }
  ).Segmenter;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor("en", { granularity: "grapheme" });
  } catch {
    return null;
  }
}

function isRenderer(r: unknown): r is LayerRenderer {
  return (
    typeof r === "object" &&
    r !== null &&
    typeof (r as LayerRenderer).mount === "function" &&
    typeof (r as LayerRenderer).reveal === "function"
  );
}

function finiteBoxes(layers: readonly Layer[]): Rect[] {
  const out: Rect[] = [];
  for (const l of layers) {
    const b = l?.box;
    if (b && Number.isFinite(b.x + b.y + b.w + b.h)) out.push(b);
  }
  return out;
}

const PX = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?px$/i;

/** Offset of a CSS `translate` value written in px ("12px" or "12px 4px"); null for anything else. */
function translateOffset(value: unknown): Point | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/\s+/);
  if (parts.length > 3 || !parts.every((part) => PX.test(part))) return null;
  const x = Number.parseFloat(parts[0] ?? "");
  const y = parts.length > 1 ? Number.parseFloat(parts[1] ?? "") : 0;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function syncWindowScroll(win: Window, x: number, y: number): void {
  const left = Number.isFinite(x) ? Math.max(0, x) : 0;
  const top = Number.isFinite(y) ? Math.max(0, y) : 0;
  try {
    // "instant" overrides a page-level `scroll-behavior: smooth`.
    win.scrollTo({ left, top, behavior: "instant" as ScrollBehavior });
  } catch {
    win.scrollTo(left, top);
  }
}

/**
 * The stage: an isolated rebuild surface for one blueprint (see the Stage contract in
 * internal.ts). Composition:
 *  - {@link buildDom}: closed shadow host, backdrop, scroller, world tree, canvas, UI layer;
 *  - {@link Geometry} + {@link ScrollController}: cached scroll/scale arithmetic, user vs. programmatic scrolls;
 *  - {@link LayerRegistry} + {@link Mounter}: per-layer build state and viewport virtualization;
 *  - {@link OverlayLayer} + {@link GuideLines}: the one canvas for cursors, overlays, rulers, guides;
 *  - {@link Fade} + {@link PageGuard}: engine-time fades and the overlay's hold on the live page.
 * Every animated value advances from `render(now)`, never from wall-clock timers or CSS transitions.
 */
export class SwarmStage implements Stage {
  readonly blueprint: Blueprint;
  readonly root: ShadowRoot;
  readonly uiLayer: HTMLElement;

  readonly #mode: "overlay" | "inline";
  readonly #reduced: boolean;
  readonly #doc: Document;
  readonly #win: Window;
  readonly #dom: StageDom;
  readonly #geo: Geometry;
  readonly #registry: LayerRegistry;
  readonly #mounter: Mounter;
  readonly #overlay: OverlayLayer;
  readonly #guides: GuideLines;
  readonly #scroll: ScrollController;
  readonly #fade: Fade;
  readonly #guard: PageGuard;
  readonly #segmenter: GraphemeSegmenter | null;
  readonly #resizeListeners = new Set<(vp: Rect) => void>();
  readonly #offs: (() => void)[] = [];
  readonly #cleanups: (() => void)[] = [];
  readonly #textUnits = new Map<Slot, number>();
  /** Typed texts with layout reads to take: in the next read phase or on a caret miss ({@link measure}). */
  readonly #reads = new Set<Slot>();
  readonly #origin: ClientOrigin = { left: 0, top: 0 };
  #originDirty = true;
  #frame = 0;
  #phase = 0;
  #gen = 0;
  #dpr = 1;
  #opacity = 1;
  #passDirty = true;
  #lastPassTop = Number.NaN;
  #lastPassFrame = 0;
  #autoHeight = false;
  #pointerIn = false;
  #pointerX = 0;
  #pointerY = 0;
  #destroyed = false;

  constructor(o: StageOptions) {
    validate(o);
    const bp = o.blueprint;
    const host = o.host;
    const doc = host.ownerDocument;
    const win = doc.defaultView as Window;
    this.blueprint = bp;
    this.#mode = o.mode;
    this.#reduced = o.reducedMotion === true;
    this.#doc = doc;
    this.#win = win;
    const plugins = (o.plugins ?? []).filter((p): p is Plugin => typeof p === "object" && p !== null);

    this.#registry = new LayerRegistry(bp.layers);
    const fallback = { w: win.innerWidth || 1280, h: win.innerHeight || 800 };
    const size = worldSize(bp.size, finiteBoxes(this.#registry.slots.map((s) => s.layer)), fallback);
    this.#geo = new Geometry(size, o.mode === "inline");

    const tokens = deriveTokens(o.theme);
    // S01: an overlay lives under <html>, outside <body>, so the page can be made inert without it.
    const parent =
      o.mode === "overlay" && (host === doc.body || host === doc.documentElement) ? doc.documentElement : host;
    this.#dom = buildDom({
      mode: o.mode,
      parent,
      base: tokens.base,
      background: typeof bp.background === "string" ? bp.background : "",
      backgroundOnBackdrop: plugins.some((p) => typeof p.setup === "function"),
      css: typeof bp.css === "string" ? bp.css : undefined,
      textColor: o.theme.scheme === "dark" ? BRAND.paper : BRAND.ink,
      focusColor: o.theme.select,
    });
    const dom = this.#dom;
    this.root = dom.root;
    this.uiLayer = dom.ui;
    dom.world.style.width = `${size.w}px`;
    dom.world.style.height = `${size.h}px`;
    if (o.mode === "overlay") {
      // Invisible and click-through until enter(); set in the same task as the insertion (no flash).
      dom.host.setAttribute("data-passive", "");
      dom.rootEl.style.opacity = "0";
      this.#opacity = 0;
    }
    this.#fade = new Fade(this.#opacity);
    this.#guard = new PageGuard(doc);
    try {
      this.#overlay = new OverlayLayer(dom.canvas, o.theme, this.#reduced);
      this.#guides = new GuideLines(this.#registry, this.#overlay.guides, this.#reduced);
      this.#scroll = new ScrollController(dom.scroller, this.#geo, this.#reduced);
      this.#scroll.onScroll = () => this.#afterScroll();
      this.#segmenter = createSegmenter();
      this.#mounter = new Mounter(this.#registry, dom.worldRoot, this.#mountEnv(plugins, tokens, o.rng));

      this.#dpr = win.devicePixelRatio || 1;
      this.#measure(false);
      const y = typeof o.initialScroll === "number" && Number.isFinite(o.initialScroll) ? o.initialScroll : 0;
      const x = o.mode === "overlay" ? win.scrollX || 0 : 0;
      this.#scroll.scrollTo(y, false, x);
      this.#listen();

      // Plugins set up before the first mount: their renderers may depend on the scene they create.
      for (const p of plugins) {
        if (typeof p.setup !== "function") continue;
        try {
          const cleanup = p.setup(this, dom.backdrop);
          if (typeof cleanup === "function") this.#cleanups.push(cleanup);
        } catch (error) {
          console.warn(`SwarmLoom stage: plugin "${String(p.name)}" setup failed`, error);
        }
      }
      this.#pass();
    } catch (error) {
      // Never leave a half-built stage in the page.
      for (const off of this.#offs) off();
      for (const cleanup of this.#cleanups) {
        try {
          cleanup();
        } catch {
          // already failing; the original error is the one to report
        }
      }
      dom.dispose();
      throw error;
    }
  }

  /* ------------------------------------------------------------ StageApi */

  get reducedMotion(): boolean {
    return this.#reduced;
  }

  layer(id: string): Layer | undefined {
    return this.#registry.get(id)?.layer;
  }

  el(id: string): HTMLElement | SVGElement | null {
    const slot = this.#registry.get(id);
    if (!slot?.dom || this.#destroyed) return null;
    slot.touched = this.#frame;
    return this.#mounter.ensure(slot)?.el ?? null;
  }

  reveal(id: string, p: number): void {
    const slot = this.#registry.get(id);
    if (!slot || this.#destroyed) return;
    const v = typeof p === "number" && Number.isFinite(p) ? clamp01(p) : 0;
    slot.p = v;
    if (v < 1) slot.finished = false;
    slot.touched = this.#frame;
    if (!slot.dom) return;
    const view = slot.view;
    if (!view) {
      // Mounting restores the recorded state, reveal included. Far layers keep only that state
      // until virtualization reaches them: a cross-fade (finish now, reduced motion) reveals the
      // whole page at once and must not mount all of it.
      if (v > 0 && this.#nearView(slot)) this.#mounter.ensure(slot);
      return;
    }
    try {
      view.reveal(v);
    } catch (error) {
      this.#report(slot, error);
    }
  }

  finish(id: string): void {
    const slot = this.#registry.get(id);
    if (!slot || this.#destroyed) return;
    slot.p = 1;
    slot.finished = true;
    slot.css = null;
    slot.touched = this.#frame;
    const view = slot.view;
    // Unmounted layers are far from the view: they mount directly in their final form later.
    if (!view) return;
    try {
      view.finish();
    } catch (error) {
      this.#report(slot, error);
    }
  }

  setStyle(id: string, css: CSSMap | null): void {
    const slot = this.#registry.get(id);
    if (!slot?.dom || this.#destroyed) return;
    const next = typeof css === "object" && css !== null ? css : null;
    slot.css = next;
    slot.touched = this.#frame;
    const view = slot.view;
    if (!view) {
      if (next) this.#mounter.ensure(slot);
      return;
    }
    try {
      view.transient(next);
    } catch (error) {
      this.#report(slot, error);
    }
  }

  overlay(kind: string, props: Record<string, unknown>): OverlayHandle {
    if (this.#destroyed) return NOOP_HANDLE;
    return this.#overlay.add(kind, props);
  }

  viewport(): Rect {
    return this.#geo.viewport({ x: 0, y: 0, w: 0, h: 0 });
  }

  caretAt(id: string, n: number): Point {
    const slot = this.#registry.get(id);
    if (!slot) return { x: 0, y: 0 };
    const box = slot.layer.box;
    const fallback = { x: box?.x ?? 0, y: box?.y ?? 0 };
    if (slot.layer.kind !== "text" || !slot.dom || this.#destroyed) return fallback;
    slot.touched = this.#frame;
    const view = this.#mounter.ensure(slot);
    if (!view?.caret) return fallback;
    let units = typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
    try {
      // Choreographies count units in Layer.text; the view counts them in the rendered markup.
      // They agree for adapter output; when they do not, map proportionally (as reveal() does).
      const dom = view.total?.() ?? 0;
      const text = this.#unitsOf(slot);
      if (text > 0 && dom !== text) units = (units / text) * dom;
      // Typing goes on: the next caret block is read ahead, between frames.
      if (!slot.finished) this.#reads.add(slot);
      // A caret not measured yet forces a layout to read: every pending read takes that layout too.
      // Seek frames have no read phase (nothing renders between them), so this is where they read.
      if (view.caretReady?.(units) === false) this.measure();
      const caret = view.caret(units);
      if (!caret) return fallback;
      // The caret goes where the text is drawn: a transient translate (text typed beside its snap
      // guide) moves it as well.
      const shift = translateOffset(slot.css?.translate);
      return shift ? { x: caret.x + shift.x, y: caret.y + shift.y } : caret;
    } catch {
      return fallback;
    }
  }

  /* --------------------------------------------------------------- Stage */

  get scrollY(): number {
    const g = this.#geo;
    return (g.scrollTop - g.offsetY) / g.scale;
  }

  get scrollX(): number {
    const g = this.#geo;
    return (g.scrollLeft - g.offsetX) / g.scale;
  }

  scrollTo(y: number, opts?: { smooth?: boolean; defer?: boolean }): void {
    if (this.#destroyed || typeof y !== "number" || !Number.isFinite(y)) return;
    this.#scroll.scrollTo(y, opts?.smooth === true, undefined, opts?.defer === true);
  }

  onUserScroll(fn: (y: number) => void): () => void {
    if (typeof fn !== "function" || this.#destroyed) return () => {};
    return this.#scroll.onUser(fn);
  }

  onResize(fn: (vp: Rect) => void): () => void {
    if (typeof fn !== "function" || this.#destroyed) return () => {};
    this.#resizeListeners.add(fn);
    return () => {
      this.#resizeListeners.delete(fn);
    };
  }

  /**
   * A task is about to work on layer `id`. A typed text is mounted now (a DOM write, which is
   * harmless mid-frame) and its first caret block is read in the next read phase (in a seek, with
   * the first caret any text misses), so typing starts on a measured caret instead of forcing a
   * layout between other agents' writes.
   */
  prefetch(id: string): void {
    const slot = this.#registry.get(id);
    if (!slot?.dom || slot.broken || slot.finished || this.#destroyed) return;
    const layer = slot.layer;
    if (layer.kind !== "text" || (layer.reveal !== undefined && layer.reveal !== "type")) return;
    slot.touched = this.#frame;
    if (this.#mounter.ensure(slot)) this.#reads.add(slot);
  }

  /**
   * Read phase, run by the engine at the start of a clock tick, before any task writes to the DOM:
   * the layout is still clean from the browser's last frame, so these reads force no layout. Also
   * run by caretAt() when a caret was not read yet, right before the layout that read forces
   * anyway. Texts that finished, unmounted or broke drop out of the list.
   */
  measure(): void {
    if (this.#destroyed) return;
    for (const slot of this.#reads) {
      const view = slot.view;
      if (!view?.measure || slot.finished || slot.broken) {
        this.#reads.delete(slot);
        continue;
      }
      try {
        view.measure();
      } catch (error) {
        this.#reads.delete(slot);
        this.#report(slot, error);
      }
    }
  }

  setRulers(on: boolean): void {
    if (!this.#destroyed) this.#overlay.setRulers(on === true, this.#reduced);
  }

  render(now: number, agents: readonly AgentView[]): void {
    if (this.#destroyed) return;
    const t = typeof now === "number" && Number.isFinite(now) ? now : 0;
    const frame = this.#nextFrame();
    this.#scroll.step(t, frame);

    const o = this.#fade.step(t);
    if (o !== this.#opacity) {
      this.#opacity = o;
      this.#dom.rootEl.style.opacity = o >= 1 ? "" : String(Math.round(o * 1000) / 1000);
    }
    const g = this.#geo;
    const dpr = this.#win.devicePixelRatio || 1;
    if (dpr !== this.#dpr) {
      this.#dpr = dpr;
      this.#overlay.resize(g.clientW, g.clientH, dpr);
    }
    this.#maybePass(frame);

    const overlay = this.#overlay;
    overlay.guideCount = this.#guides.update(t, overlay.guides);
    const v = overlay.view;
    v.scale = g.scale;
    v.originX = g.offsetX - g.scrollLeft;
    v.originY = g.offsetY - g.scrollTop;
    v.scrollX = (g.scrollLeft - g.offsetX) / g.scale;
    v.scrollY = (g.scrollTop - g.offsetY) / g.scale;
    overlay.render(t, Array.isArray(agents) ? agents : NO_AGENTS);
  }

  /**
   * A frame the engine simulated without drawing (seek): task touches age and virtualization
   * runs as in render(), so the layers a seek builds on its way down the page unmount again
   * instead of all staying mounted until 120 frames after the seek.
   */
  skipFrame(): void {
    if (this.#destroyed) return;
    this.#maybePass(this.#nextFrame());
  }

  enter(): Promise<void> {
    if (this.#destroyed) return Promise.resolve();
    this.#phase++;
    const dom = this.#dom;
    dom.setLive(false);
    this.#overlay.setHidden(false);
    if (this.#mode === "inline") {
      this.#fade.set(1);
      this.#setOpacity(1);
      return Promise.resolve();
    }
    if (!dom.attached) {
      // Replay after going live: back over the page where the stage was.
      dom.attach();
      this.#measure();
      this.#scroll.restore();
    }
    this.#guard.engage(dom.host);
    dom.host.removeAttribute("data-passive");
    try {
      // Keyboard scrolling (arrows, Page Up/Down) goes to the stage while the page is inert. Focus
      // already on the stage stays put: a replay started from the toolbar (Replay, a key step back
      // on the seek bar) must leave it on that control, or the next arrow key scrolls the stage.
      if (!dom.root.activeElement) dom.scroller.focus({ preventScroll: true });
    } catch {
      // focus is best effort
    }
    return this.#fade.start(1, this.#reduced ? REDUCED_FADE_MS : ENTER_MS);
  }

  finishAll(): void {
    if (this.#destroyed) return;
    for (const slot of this.#registry.slots) {
      if (slot.finished && slot.css === null) continue;
      slot.p = 1;
      slot.finished = true;
      slot.css = null;
      try {
        slot.view?.finish();
      } catch (error) {
        this.#report(slot, error);
      }
    }
  }

  reset(): void {
    if (this.#destroyed) return;
    this.#phase++;
    // Before the views go: focus on a link of the live content moves to the stage, not to <body>.
    this.#dom.setLive(false);
    this.#scroll.cancel();
    // Fresh views are the only state guaranteed to carry nothing over from the previous build.
    this.#mounter.unmountAll();
    this.#reads.clear();
    for (const slot of this.#registry.slots) {
      slot.p = 0;
      slot.finished = false;
      slot.css = null;
      slot.touched = -1;
    }
    this.#guides.reset();
    const overlay = this.#overlay;
    overlay.clearOverlays();
    overlay.setHidden(false);
    overlay.setRulers(false, true);
    if (this.#fade.active) this.#fade.set(this.#fade.value);
    this.#passDirty = true;
  }

  async goLive(): Promise<void> {
    if (this.#destroyed) return;
    const phase = ++this.#phase;
    const dom = this.#dom;
    const overlay = this.#overlay;
    overlay.setRulers(false, true);
    overlay.setHidden(true);
    if (this.#mode === "inline") {
      // Content stays; it becomes a page again (readable, focusable links, selectable text, running animations).
      dom.setLive(true);
      return;
    }
    // The page takes input again the moment the dissolve starts.
    dom.host.setAttribute("data-passive", "");
    const x = this.scrollX;
    const y = this.scrollY;
    this.#guard.release(true);
    syncWindowScroll(this.#win, x, y);
    if (dom.attached) await this.#fade.start(0, this.#reduced ? REDUCED_FADE_MS : LIVE_MS);
    if (phase !== this.#phase || this.#destroyed) return;
    dom.detach();
  }

  pointer(): Point | null {
    if (!this.#pointerIn || this.#destroyed) return null;
    return this.toStage({ x: this.#pointerX, y: this.#pointerY });
  }

  toClient(p: Point): Point {
    return this.#geo.toClient(p, this.#clientOrigin());
  }

  toStage(p: Point): Point {
    return this.#geo.toStage(p, this.#clientOrigin());
  }

  async ready(): Promise<void> {
    if (this.#destroyed) return;
    this.#pass();
    // One layout, so text that uses web fonts starts loading them before fonts.ready is read.
    void this.#dom.world.offsetWidth;
    const waits: Promise<unknown>[] = [];
    for (const slot of this.#mounter.mounted) {
      const view = slot.view;
      if (view?.decode) waits.push(view.decode().catch(() => undefined));
    }
    const fonts = (this.#doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) waits.push(fonts.ready.catch(() => undefined));
    waits.push(this.#overlay.imagesSettled());
    let timer = 0;
    const timeout = new Promise<void>((resolve) => {
      timer = this.#win.setTimeout(resolve, READY_TIMEOUT_MS);
    });
    await Promise.race([Promise.all(waits), timeout]);
    this.#win.clearTimeout(timer);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#phase++;
    for (const off of this.#offs) off();
    this.#offs.length = 0;
    this.#scroll.dispose();
    for (let i = this.#cleanups.length - 1; i >= 0; i--) {
      try {
        this.#cleanups[i]?.();
      } catch (error) {
        console.warn("SwarmLoom stage: plugin cleanup failed", error);
      }
    }
    this.#cleanups.length = 0;
    this.#mounter.dispose();
    this.#overlay.destroy();
    this.#fade.set(this.#fade.value);
    this.#guard.release(true);
    this.#dom.dispose();
    this.#resizeListeners.clear();
    this.#textUnits.clear();
    this.#reads.clear();
  }

  /* ----------------------------------------------------------- internals */

  /** Virtualization counters (tests, diagnostics). */
  get stats(): MountStats {
    return this.#mounter.stats;
  }

  /** A throwing view degrades that layer only: reported once, never fatal to the stage. */
  #report(slot: Slot, error: unknown): void {
    if (slot.broken) return;
    slot.broken = true;
    console.warn(`SwarmLoom stage: layer "${slot.layer.id}" failed to update`, error);
  }

  #unitsOf(slot: Slot): number {
    let n = this.#textUnits.get(slot);
    if (n === undefined) {
      const text = (slot.layer as { text?: unknown }).text;
      n = typeof text === "string" ? countTypingUnits(text, this.#segmenter) : 0;
      this.#textUnits.set(slot, n);
    }
    return n;
  }

  #setOpacity(o: number): void {
    this.#opacity = o;
    this.#dom.rootEl.style.opacity = o >= 1 ? "" : String(o);
  }

  #clientOrigin(): ClientOrigin {
    if (this.#originDirty && this.#dom.attached) {
      const r = this.#dom.scroller.getBoundingClientRect();
      this.#origin.left = r.left;
      this.#origin.top = r.top;
      this.#originDirty = false;
    }
    return this.#origin;
  }

  /** Advances the frame counter that dates task touches (and expires them in the mounter). */
  #nextFrame(): number {
    const frame = ++this.#frame;
    this.#mounter.frame = frame;
    return frame;
  }

  #maybePass(frame: number): void {
    const g = this.#geo;
    const top = (g.scrollTop - g.offsetY) / g.scale;
    const h = g.clientH / g.scale;
    if (
      this.#passDirty ||
      !(Math.abs(top - this.#lastPassTop) <= h * PASS_SCROLL_FRACTION) ||
      frame - this.#lastPassFrame >= PASS_EVERY_FRAMES
    ) {
      this.#pass();
    }
  }

  /** Top of the visible view, stage px. */
  #viewTop(): number {
    const g = this.#geo;
    return (g.scrollTop - g.offsetY) / g.scale;
  }

  /** Height of the visible view, stage px (the whole world before the first measure). */
  #viewHeight(): number {
    const g = this.#geo;
    return (g.clientH || g.worldH) / g.scale;
  }

  /** True when a virtualization pass for the current view would mount `slot`. */
  #nearView(slot: Slot): boolean {
    const top = this.#viewTop();
    return this.#mounter.near(slot, top, top + this.#viewHeight());
  }

  /** Virtualization pass for the current view. */
  #pass(): void {
    if (this.#destroyed) return;
    const top = this.#viewTop();
    this.#mounter.pass(top, top + this.#viewHeight());
    this.#lastPassTop = top;
    this.#lastPassFrame = this.#frame;
    this.#passDirty = false;
  }

  /** Scroll events also arrive when the engine no longer renders (inline stage after go-live). */
  #afterScroll(): void {
    this.#maybePass(this.#frame);
  }

  /**
   * Reads the visible client size (layout read: construction, resize, re-attach only). `pass`:
   * run a virtualization pass afterwards (not during construction, before plugins are set up).
   */
  #measure(pass = true): void {
    if (this.#destroyed || !this.#dom.attached) return;
    const dom = this.#dom;
    const g = this.#geo;
    let w = dom.scroller.clientWidth;
    let h = dom.scroller.clientHeight;
    if (this.#mode === "inline" && h === 0 && w > 0 && !this.#autoHeight) {
      // A container without a height: size the stage by the content's aspect ratio (capped at 100vh).
      this.#autoHeight = true;
      const vh = this.blueprint.viewport?.h;
      const shown = typeof vh === "number" && vh > 0 ? Math.min(vh, g.worldH) : g.worldH;
      dom.host.style.setProperty("--sl-ratio", `${g.worldW} / ${Math.max(1, shown)}`);
      dom.host.setAttribute("data-autoheight", "");
      w = dom.scroller.clientWidth;
      h = dom.scroller.clientHeight;
    }
    const prevW = g.clientW;
    const prevH = g.clientH;
    const x = (g.scrollLeft - g.offsetX) / g.scale;
    const y = (g.scrollTop - g.offsetY) / g.scale;
    const scaled = g.layout(w, h);
    dom.sizer.style.width = `${g.extentW}px`;
    dom.sizer.style.height = `${g.extentH}px`;
    dom.world.style.transform = g.worldTransform();
    this.#overlay.resize(w, h, this.#dpr);
    this.#originDirty = true;
    if (scaled) {
      this.#gen++;
      // Keep the same stage point at the top-left corner across a scale change.
      this.#scroll.scrollTo(y, false, x);
    }
    this.#passDirty = true;
    if (pass) this.#pass();
    if ((w !== prevW || h !== prevH) && this.#resizeListeners.size > 0) {
      const vp = this.viewport();
      for (const fn of [...this.#resizeListeners]) {
        try {
          fn({ ...vp });
        } catch (error) {
          console.warn("SwarmLoom stage: onResize listener failed", error);
        }
      }
    }
  }

  #listen(): void {
    const win = this.#win;
    const dom = this.#dom;
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ): void => {
      el.addEventListener(type, fn, { passive: true });
      this.#offs.push(() => el.removeEventListener(type, fn));
    };

    const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof RO === "function") {
      const ro = new RO(() => this.#measure());
      ro.observe(dom.host);
      this.#offs.push(() => ro.disconnect());
    }
    const resize = (): void => this.#measure();
    win.addEventListener("resize", resize, { passive: true });
    this.#offs.push(() => win.removeEventListener("resize", resize));
    // Any ancestor scroll moves an inline stage on screen (scroll events do not bubble; capture sees them).
    const moved = (): void => {
      this.#originDirty = true;
    };
    win.addEventListener("scroll", moved, { capture: true, passive: true });
    this.#offs.push(() => win.removeEventListener("scroll", moved, { capture: true }));

    const fonts = (this.#doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts && typeof fonts.addEventListener === "function") {
      const loaded = (): void => {
        this.#gen++;
      };
      fonts.addEventListener("loadingdone", loaded);
      this.#offs.push(() => fonts.removeEventListener("loadingdone", loaded));
    }

    const root = dom.rootEl;
    const track = (e: PointerEvent): void => {
      this.#pointerX = e.clientX;
      this.#pointerY = e.clientY;
      this.#pointerIn = true;
    };
    const end = (e: PointerEvent): void => {
      // A lifted finger or pen leaves no hovering pointer behind.
      if (e.type !== "pointerup" || e.pointerType !== "mouse") this.#pointerIn = false;
    };
    on(root, "pointermove", track);
    on(root, "pointerdown", track);
    on(root, "pointerup", end);
    on(root, "pointercancel", end);
    on(root, "pointerleave", end);
  }

  #mountEnv(plugins: readonly Plugin[], tokens: Tokens, rng: () => number): MountEnv {
    const doc = this.#doc;
    const r = Number(rng());
    const seed = Math.floor((Number.isFinite(r) ? r - Math.floor(r) : 0) * 0x100000000) >>> 0;
    const renderers = new Map<string, LayerRenderer>();
    // Later plugins override earlier ones (same precedence as the engine's task lookup).
    for (const p of plugins) {
      const table = p.renderers;
      if (typeof table !== "object" || table === null) continue;
      for (const key of Object.keys(table)) {
        const renderer = table[key];
        if (isRenderer(renderer)) renderers.set(key, renderer);
      }
    }
    const fragments = new FragmentCache(doc, FRAGMENT_CACHE_LIMIT);
    /** 0: unknown, 1: style attributes apply, 2: the page CSP drops them. */
    let inlineStyleState = 0;
    let uid = 0;
    return {
      doc,
      tokens,
      seed,
      reducedMotion: this.#reduced,
      api: this,
      segmenter: this.#segmenter,
      renderer: (task) => renderers.get(task),
      scale: () => this.#geo.scale,
      geometryGen: () => this.#gen,
      html: (id, raw) => fragments.copy(id, raw),
      inlineStyles: (root) => {
        if (inlineStyleState === 1) return;
        if (inlineStyleState === 0) {
          const probe = root.querySelector<HTMLElement>("[style]");
          if (!probe || !/:/.test(probe.getAttribute("style") ?? "")) return;
          inlineStyleState = probe.style.length > 0 ? 1 : 2;
          if (inlineStyleState === 1) return;
        }
        reapplyStyleAttributes(root);
      },
      uid: (prefix) => `sl-${prefix}${++uid}`,
    };
  }
}
