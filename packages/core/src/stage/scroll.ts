import type { Geometry } from "./geometry";

/** Scroll events within this many render frames of wheel/touch/key/scrollbar input are the user's. */
const INPUT_FRAMES = 30;
/** Programmatic positions are matched with this tolerance (browsers snap scroll offsets to device pixels). */
const MATCH_PX = 1.5;
const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]);

interface SmoothScroll {
  fromTop: number;
  toTop: number;
  startAt: number;
  dur: number;
}

/**
 * The stage scroller: programmatic scrolls (instant, or smooth and driven by engine time so
 * exports stay deterministic) and the separation of user scrolls from them. A scroll event is the
 * user's when wheel, touch, navigation-key or scrollbar input preceded it, or when it lands where
 * no programmatic scroll put the scroller. Offsets are cached in the Geometry so the frame path
 * never reads layout; only user scrolls replace the cache with the scroller's (snapped) offsets,
 * so frames never depend on when the browser dispatched a scroll event. A deferred scroll updates
 * the cache at once and writes the scroller in the next {@link step}: a seek moves the tour every
 * frame it fast-forwards between task writes, and every scroller write after a DOM write forces a
 * layout.
 */
export class ScrollController {
  readonly #el: HTMLElement;
  readonly #geo: Geometry;
  readonly #reducedMotion: boolean;
  readonly #listeners = new Set<(y: number) => void>();
  readonly #off: (() => void)[] = [];
  #expectTop = Number.NaN;
  #expectLeft = Number.NaN;
  #inputFrame = -1e9;
  #frame = 0;
  #smooth: SmoothScroll | null = null;
  #onScroll: (() => void) | null = null;
  /** Deferred offsets not yet written to the scroller. */
  #pendingTop = false;
  #pendingLeft = false;

  constructor(scroller: HTMLElement, geometry: Geometry, reducedMotion: boolean) {
    this.#el = scroller;
    this.#geo = geometry;
    this.#reducedMotion = reducedMotion;
    const input = (): void => {
      this.#inputFrame = this.#frame;
      this.#smooth = null;
    };
    const key = (e: KeyboardEvent): void => {
      if (NAV_KEYS.has(e.key)) input();
    };
    const down = (e: PointerEvent): void => {
      // Only presses on the scroller itself (its scrollbar); content never takes pointer input.
      if (e.target === scroller) input();
    };
    const scroll = (): void => this.#handleScroll();
    const passive: AddEventListenerOptions = { passive: true };
    scroller.addEventListener("scroll", scroll, passive);
    scroller.addEventListener("wheel", input, passive);
    scroller.addEventListener("touchstart", input, passive);
    scroller.addEventListener("touchmove", input, passive);
    scroller.addEventListener("keydown", key);
    scroller.addEventListener("pointerdown", down, passive);
    this.#off.push(
      () => scroller.removeEventListener("scroll", scroll),
      () => scroller.removeEventListener("wheel", input),
      () => scroller.removeEventListener("touchstart", input),
      () => scroller.removeEventListener("touchmove", input),
      () => scroller.removeEventListener("keydown", key),
      () => scroller.removeEventListener("pointerdown", down),
    );
  }

  /** Called after every scroll event (user or programmatic) once offsets are cached. */
  set onScroll(fn: (() => void) | null) {
    this.#onScroll = fn;
  }

  onUser(fn: (y: number) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  /**
   * Scrolls so stage y is at the top edge (and stage x at the left edge when given). `defer` keeps
   * the scroller write for the next {@link step}; a smooth scroll is driven by step anyway.
   */
  scrollTo(y: number, smooth: boolean, x?: number, defer = false): void {
    const g = this.#geo;
    const top = g.scrollTopFor(y);
    if (smooth && !this.#reducedMotion && Math.abs(top - g.scrollTop) > 1) {
      const dist = Math.abs(top - g.scrollTop);
      this.#smooth = { fromTop: g.scrollTop, toTop: top, startAt: Number.NaN, dur: clamp(240 + dist * 0.18, 280, 720) };
      this.#inputFrame = -1e9;
      return;
    }
    this.#smooth = null;
    this.#inputFrame = -1e9;
    this.#set(top, x === undefined ? g.scrollLeft : g.scrollLeftFor(x), false, defer);
  }

  /** Re-applies the cached offsets (after a re-attach or a geometry change), clamped to the new range. */
  restore(): void {
    const g = this.#geo;
    this.#set(Math.min(g.scrollTop, g.maxScrollTop), Math.min(g.scrollLeft, g.maxScrollLeft), true);
  }

  /** Advances a smooth scroll to engine time `now` and writes deferred offsets; call once per frame. */
  step(now: number, frame: number): void {
    this.#frame = frame;
    const s = this.#smooth;
    if (!s) {
      if (this.#pendingTop || this.#pendingLeft) this.#set(this.#geo.scrollTop, this.#geo.scrollLeft);
      return;
    }
    if (!Number.isFinite(s.startAt)) s.startAt = now;
    const t = (now - s.startAt) / s.dur;
    const done = !(t < 1);
    const k = done ? 1 : t <= 0 ? 0 : 1 - (1 - t) ** 3;
    if (done) this.#smooth = null;
    this.#set(s.fromTop + (s.toTop - s.fromTop) * k, this.#geo.scrollLeft);
  }

  /** Cancels a running smooth scroll (reset, destroy). */
  cancel(): void {
    this.#smooth = null;
  }

  dispose(): void {
    for (const off of this.#off) off();
    this.#off.length = 0;
    this.#listeners.clear();
    this.#smooth = null;
    this.#onScroll = null;
  }

  /**
   * Writes the offsets. Only changed or still deferred values are written (compared with the
   * cache, not read back: reading scroll offsets mid-frame would force a layout); `force` writes
   * both (re-attach); `defer` only updates the cache and leaves the write to the next step.
   */
  #set(top: number, left: number, force = false, defer = false): void {
    const g = this.#geo;
    const el = this.#el;
    const writeTop = force || this.#pendingTop || top !== g.scrollTop;
    const writeLeft = force || this.#pendingLeft || left !== g.scrollLeft;
    g.scrollTop = top;
    g.scrollLeft = left;
    this.#expectTop = top;
    this.#expectLeft = left;
    this.#pendingTop = defer && writeTop;
    this.#pendingLeft = defer && writeLeft;
    if (defer) return;
    if (writeTop) el.scrollTop = top;
    if (writeLeft) el.scrollLeft = left;
  }

  #handleScroll(): void {
    const el = this.#el;
    const g = this.#geo;
    const top = el.scrollTop;
    const left = el.scrollLeft;
    const recentInput = this.#frame - this.#inputFrame <= INPUT_FRAMES;
    const expected = Math.abs(top - this.#expectTop) <= MATCH_PX && Math.abs(left - this.#expectLeft) <= MATCH_PX;
    if (!recentInput && (expected || this.#smooth)) {
      // Our own scroll: the cache keeps the exact offsets written, not the device-pixel-snapped
      // ones read back. The event comes with the browser's next rendering update, so adopting
      // them would make the following frames depend on wall-clock timing (exports would differ).
      this.#onScroll?.();
      return;
    }
    // A user scroll: the scroller's offsets are the truth from here on, deferred ones included.
    g.scrollTop = top;
    g.scrollLeft = left;
    this.#pendingTop = false;
    this.#pendingLeft = false;
    this.#onScroll?.();
    this.#smooth = null;
    this.#expectTop = Number.NaN;
    this.#expectLeft = Number.NaN;
    if (this.#listeners.size === 0) return;
    const y = (top - g.offsetY) / g.scale;
    for (const fn of [...this.#listeners]) {
      try {
        fn(y);
      } catch (error) {
        console.warn("SwarmLoom stage: onUserScroll listener failed", error);
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
