import { vi } from "vitest";
import type { Player, PlayerEvent, PlayerState } from "../../src/types";

type Listener = (e: PlayerEvent) => void;

/** Minimal in-memory Player: records calls and lets tests push state/progress events. */
export function createFakePlayer(initial: PlayerState = "building") {
  const listeners = new Map<string, Set<Listener>>();
  let state: PlayerState = initial;
  let progress = { built: 0, total: 0 };
  const emit = (e: PlayerEvent): void => {
    for (const fn of listeners.get(e.type) ?? []) fn(e);
  };
  const player = {
    get state() {
      return state;
    },
    get progress() {
      return progress;
    },
    soundLog: [],
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    resume: vi.fn(),
    setSpeed: vi.fn(),
    setSound: vi.fn(),
    setFollow: vi.fn(),
    replay: vi.fn(),
    goLive: vi.fn(),
    destroy: vi.fn(),
    eta: vi.fn(() => 12_000),
    ready: vi.fn(() => Promise.resolve()),
    on(type: string, fn: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      listeners.set(type, set);
      set.add(fn);
      return () => set.delete(fn);
    },
  };
  return {
    player: player as unknown as Player & typeof player,
    setState(next: PlayerState) {
      state = next;
      emit({ type: "state", state: next });
    },
    setProgress(built: number, total: number) {
      progress = { built, total };
      emit({ type: "progress", built, total });
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}
