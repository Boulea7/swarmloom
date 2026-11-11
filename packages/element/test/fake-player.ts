import type { Player, PlayerEvent, PlayerOptions, PlayerState, SoundEvent } from "@swarmloom/core";

type Listener = (e: PlayerEvent) => void;

/** Minimal in-memory Player: tests drive the build with `finish()`; every call is recorded. */
export class FakePlayer implements Player {
  state: PlayerState = "idle";
  progress = { built: 0, total: 3 };
  soundLog: SoundEvent[] = [];
  calls: string[] = [];
  speed: number;
  sound: boolean;
  readonly options: PlayerOptions;
  #listeners = new Map<string, Set<Listener>>();
  #resolve: (() => void) | null = null;

  constructor(options: PlayerOptions) {
    this.options = options;
    this.speed = options.speed ?? 1;
    this.sound = options.sound === true;
  }

  play(): Promise<void> {
    this.calls.push("play");
    this.#set("building");
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }
  pause(): void {
    this.calls.push("pause");
    this.#set("paused");
  }
  resume(): void {
    this.calls.push("resume");
    this.#set("building");
  }
  setSpeed(speed: number): void {
    this.speed = speed;
  }
  setSound(enabled: boolean): void {
    this.sound = enabled;
  }
  setFollow(): void {}
  replay(): void {
    this.calls.push("replay");
    this.progress = { built: 0, total: 3 };
    this.#set("building");
  }
  goLive(): void {
    this.#set("live");
  }
  destroy(): void {
    this.calls.push("destroy");
    this.#set("destroyed");
  }
  on<T extends PlayerEvent["type"]>(type: T, fn: (e: Extract<PlayerEvent, { type: T }>) => void): () => void {
    const set = this.#listeners.get(type) ?? new Set();
    this.#listeners.set(type, set);
    set.add(fn as Listener);
    return () => set.delete(fn as Listener);
  }
  eta(): number {
    return 1000;
  }
  ready(): Promise<void> {
    return Promise.resolve();
  }

  /** Enters the finale; like the real player, play() resolves here, before "done". */
  finale(): void {
    this.#set("finale");
    this.#resolve?.();
  }

  /** Completes the build: progress to total, state done, play() resolves. */
  finish(): void {
    this.progress = { built: 3, total: 3 };
    this.#emit({ type: "progress", built: 3, total: 3 });
    this.#set("done");
    this.#resolve?.();
  }

  #set(state: PlayerState): void {
    this.state = state;
    this.#emit({ type: "state", state });
  }

  #emit(e: PlayerEvent): void {
    for (const fn of this.#listeners.get(e.type) ?? []) fn(e);
  }
}
