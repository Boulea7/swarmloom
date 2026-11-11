import type { Player, PlayerEvent, PlayerOptions, PlayerState, SoundEvent, VirtualClockLike } from "@swarmloom/core";

type Listener = (e: PlayerEvent) => void;

/**
 * Clock-driven fake: builds `total` layers evenly over `buildMs` of clock time, logs a key sound per
 * layer and switches to "finale" when done. Counts ready() calls so tests can check the step barrier.
 */
export class ClockPlayer implements Player {
  state: PlayerState = "idle";
  progress = { built: 0, total: 4 };
  soundLog: SoundEvent[] = [];
  readyCalls = 0;
  destroyed = false;
  readonly options: PlayerOptions;
  readonly #clock: VirtualClockLike;
  readonly #buildMs: number;
  #listeners = new Map<string, Set<Listener>>();

  constructor(options: PlayerOptions, buildMs = 1000) {
    if (!options.clock || !("advance" in options.clock)) throw new Error("needs a VirtualClock");
    this.options = options;
    this.#clock = options.clock as VirtualClockLike;
    this.#buildMs = buildMs;
  }

  play(): Promise<void> {
    this.#set("building");
    return new Promise((resolve) => {
      const off = this.#clock.onTick((_dt, now) => {
        const built = Math.min(this.progress.total, Math.floor((now / this.#buildMs) * this.progress.total));
        for (let i = this.progress.built; i < built; i++) this.soundLog.push({ t: now, name: "key", pan: 0 });
        this.progress = { ...this.progress, built };
        if (built === this.progress.total) {
          off();
          this.#set("finale");
          resolve();
        }
      });
    });
  }
  pause(): void {}
  resume(): void {}
  setSpeed(): void {}
  setSound(): void {}
  setFollow(): void {}
  replay(): void {}
  goLive(): void {}
  destroy(): void {
    this.destroyed = true;
    this.#set("destroyed");
  }
  on<T extends PlayerEvent["type"]>(type: T, fn: (e: Extract<PlayerEvent, { type: T }>) => void): () => void {
    const set = this.#listeners.get(type) ?? new Set();
    this.#listeners.set(type, set);
    set.add(fn as Listener);
    return () => set.delete(fn as Listener);
  }
  eta(): number {
    return this.#buildMs;
  }
  ready(): Promise<void> {
    this.readyCalls++;
    return Promise.resolve();
  }

  /** Delivers `event` to its listeners, as the engine would. */
  emit(event: PlayerEvent): void {
    for (const fn of this.#listeners.get(event.type) ?? []) fn(event);
  }

  #set(state: PlayerState): void {
    this.state = state;
    this.emit({ type: "state", state });
  }
}
