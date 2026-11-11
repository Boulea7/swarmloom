import type { Player, PlayerEvent, PlayerOptions, PlayerState, SoundEvent, VirtualClockLike } from "@swarmloom/core";

type Listener = (e: PlayerEvent) => void;

/**
 * Clock-driven fake: builds `total` layers evenly over `buildMs` of player time, logs a key sound per
 * layer and switches to "finale" when done. Like the engine, player time stops while paused and
 * sound events carry player time. Counts ready() calls so tests can check the step barrier.
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
  #pt = 0;
  #finishing = false;
  #resumeState: PlayerState = "building";

  constructor(options: PlayerOptions, buildMs = 1000) {
    if (!options.clock || !("advance" in options.clock)) throw new Error("needs a VirtualClock");
    this.options = options;
    this.#clock = options.clock as VirtualClockLike;
    this.#buildMs = buildMs;
  }

  play(): Promise<void> {
    this.#set("building");
    return new Promise((resolve) => {
      const off = this.#clock.onTick((dt) => {
        if (this.state === "paused") return;
        this.#pt += dt;
        const pt = this.#pt;
        const total = this.progress.total;
        const built = this.#finishing ? total : Math.min(total, Math.floor((pt / this.#buildMs) * total));
        for (let i = this.progress.built; i < built; i++) this.soundLog.push({ t: pt, name: "key", pan: 0 });
        this.progress = { ...this.progress, built };
        if (built === this.progress.total) {
          off();
          this.#set("finale");
          resolve();
        }
      });
    });
  }
  pause(): void {
    if (this.state !== "building") return;
    this.#resumeState = this.state;
    this.#set("paused");
  }
  resume(): void {
    if (this.state === "paused") this.#set(this.#resumeState);
  }
  /** Completes the remaining layers on the next tick. */
  finish(): void {
    if (this.state === "paused") this.#set(this.#resumeState);
    if (this.state === "building") this.#finishing = true;
  }
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

  #set(state: PlayerState): void {
    this.state = state;
    for (const fn of this.#listeners.get("state") ?? []) fn({ type: "state", state });
  }
}
