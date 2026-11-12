import type { Clock, VirtualClockLike } from "./types";

type TickFn = (dt: number, now: number, draw?: boolean) => void;

function emit(listeners: ReadonlySet<TickFn>, dt: number, now: number, draw: boolean): void {
  // Iterate over a copy so listeners may unsubscribe while being called.
  for (const fn of [...listeners]) fn(dt, now, draw);
}

export interface RealtimeClockOptions {
  /**
   * Largest delta delivered in one tick, in ms. Longer gaps (background tabs, debugger pauses)
   * are clamped so the engine never jumps ahead. Default 100.
   */
  maxDeltaMs?: number;
  /** Frame scheduler. Default `requestAnimationFrame`, or a 16 ms timer where it does not exist. */
  requestFrame?: (cb: () => void) => unknown;
  /** Cancels a handle returned by `requestFrame`. */
  cancelFrame?: (handle: unknown) => void;
  /** Monotonic time source in ms. Default `performance.now`. */
  time?: () => number;
}

function defaultScheduler(): Pick<Required<RealtimeClockOptions>, "requestFrame" | "cancelFrame"> {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return {
      requestFrame: (cb) => globalThis.requestAnimationFrame(() => cb()),
      cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle as number),
    };
  }
  return {
    requestFrame: (cb) => setTimeout(cb, 16),
    cancelFrame: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/**
 * Wall-clock driven {@link Clock} that ticks once per animation frame.
 *
 * `now()` is the sum of all delivered deltas, so it never advances while the clock is stopped
 * and always matches what tick listeners have seen.
 */
export class RealtimeClock implements Clock {
  readonly #listeners = new Set<TickFn>();
  readonly #maxDelta: number;
  readonly #requestFrame: (cb: () => void) => unknown;
  readonly #cancelFrame: (handle: unknown) => void;
  readonly #time: () => number;
  #elapsed = 0;
  #last = 0;
  #handle: unknown = null;
  #running = false;

  constructor(options: RealtimeClockOptions = {}) {
    const fallback = defaultScheduler();
    this.#maxDelta = options.maxDeltaMs ?? 100;
    if (!(this.#maxDelta > 0)) throw new RangeError("maxDeltaMs must be a positive number");
    this.#requestFrame = options.requestFrame ?? fallback.requestFrame;
    this.#cancelFrame = options.cancelFrame ?? fallback.cancelFrame;
    this.#time = options.time ?? (() => performance.now());
  }

  get running(): boolean {
    return this.#running;
  }

  now(): number {
    return this.#elapsed;
  }

  onTick(fn: TickFn): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#last = this.#time();
    this.#handle = this.#requestFrame(this.#frame);
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#handle !== null) this.#cancelFrame(this.#handle);
    this.#handle = null;
  }

  readonly #frame = (): void => {
    this.#handle = null;
    if (!this.#running) return;
    const t = this.#time();
    const dt = Math.min(Math.max(t - this.#last, 0), this.#maxDelta);
    this.#last = t;
    this.#elapsed += dt;
    // Schedule first so a throwing listener cannot stall the clock.
    this.#handle = this.#requestFrame(this.#frame);
    emit(this.#listeners, dt, this.#elapsed, true);
  };
}

/**
 * Manually driven {@link Clock} for frame-exact export and tests.
 *
 * Time moves only through `advance(ms)`, and only while the clock is running: advancing a
 * stopped clock is a documented no-op, which is how a paused player stays frozen during export.
 */
export class VirtualClock implements VirtualClockLike {
  readonly #listeners = new Set<TickFn>();
  #elapsed = 0;
  #running = false;
  #ticking = false;

  get running(): boolean {
    return this.#running;
  }

  now(): number {
    return this.#elapsed;
  }

  onTick(fn: TickFn): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  start(): void {
    this.#running = true;
  }

  stop(): void {
    this.#running = false;
  }

  /**
   * Moves time forward by `ms` (>= 0) and delivers exactly one tick when running. `draw: false`
   * marks a tick whose frame nobody sees (an exporter's tick between two captured frames): listeners
   * advance their state but may skip painting.
   */
  advance(ms: number, options?: { draw?: boolean }): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`advance() needs a finite ms >= 0, got ${ms}`);
    if (this.#ticking) throw new Error("advance() must not be called from a tick listener");
    if (!this.#running) return;
    this.#elapsed += ms;
    this.#ticking = true;
    try {
      emit(this.#listeners, ms, this.#elapsed, options?.draw !== false);
    } finally {
      this.#ticking = false;
    }
  }
}
