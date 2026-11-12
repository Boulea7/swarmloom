import type { Player, PlayerEvent, PlayerOptions, PlayerState, SoundEvent, VirtualClockLike } from "@swarmloom/core";

type Listener = (e: PlayerEvent) => void;

/**
 * Clock-driven fake: builds `total` layers evenly over `buildMs` of player time, logs a key sound per
 * layer (and a fan-out on finish()) and switches to "finale" when done. Like the engine, player time
 * stops while paused and sound events carry player time. Counts ready() calls so tests can check the
 * step barrier.
 */
export class ClockPlayer implements Player {
  state: PlayerState = "idle";
  progress = { built: 0, total: 4 };
  soundLog: SoundEvent[] = [];
  readyCalls = 0;
  destroyed = false;
  readonly speeds: [number, number][] = [];
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
  /** Logs a fan-out at once (as the engine does from its intro); the remaining layers complete on the next tick. */
  finish(): void {
    if (this.state === "paused") this.#set(this.#resumeState);
    if (this.state !== "building" || this.#finishing) return;
    this.#finishing = true;
    this.soundLog.push({ t: this.#pt, name: "fanout", pan: 0 });
  }
  /** Records each setSpeed() call with the player time it came at. */
  setSpeed(speed: number): void {
    this.speeds.push([this.#pt, speed]);
  }
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
