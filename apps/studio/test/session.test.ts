import type { Player, PlayerEvent, PlayerState } from "@swarmloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioServices } from "../src/services";
import { Session, type SessionPhase } from "../src/session";
import { DEFAULT_SETTINGS } from "../src/settings";

type Listener = (event: PlayerEvent) => void;

/** A player that reports a non-fatal engine error on play, like a blueprint diagnostic, then finishes. */
function reportingPlayer(): Player {
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: PlayerEvent) => {
    for (const fn of listeners.get(event.type) ?? []) fn(event);
  };
  const noop = () => undefined;
  return {
    state: "idle",
    progress: { built: 0, total: 2 },
    soundLog: [],
    async play() {
      emit({ type: "error", error: new Error("blueprint: 1 reference(s) to missing layers ignored") });
      emit({ type: "state", state: "building" });
      emit({ type: "progress", built: 2, total: 2 });
      emit({ type: "state", state: "done" });
    },
    pause: noop,
    resume: noop,
    setSpeed: noop,
    setSound: noop,
    setFollow: noop,
    replay: noop,
    goLive: noop,
    destroy: noop,
    on(type, fn) {
      const set = listeners.get(type) ?? new Set<Listener>();
      listeners.set(type, set);
      set.add(fn as Listener);
      return () => set.delete(fn as Listener);
    },
    eta: () => 0,
    ready: async () => undefined,
  };
}

/**
 * A seekable player whose build ends at 30 s (after a 2 s intro) while eta() reads 40% short,
 * like the demo page in scroll mode. seek() replays in 100 ms frames, so the finale state event
 * fires at the real end even when the target lies past it.
 */
function slowPlayer(): Player & { time: number } {
  const INTRO = 2_000;
  const END = 30_000;
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: PlayerEvent) => {
    for (const fn of listeners.get(event.type) ?? []) fn(event);
  };
  let time = 0;
  let state: PlayerState = "idle";
  const progress = { built: 0, total: 100 };
  const frame = () => {
    const built = Math.max(0, Math.min(100, Math.floor(((time - INTRO) / (END - INTRO)) * 100)));
    if (built !== progress.built) {
      progress.built = built;
      emit({ type: "progress", built, total: 100 });
    }
    const next: PlayerState = time < INTRO ? "intro" : time < END ? "building" : "finale";
    if (next !== state) {
      state = next;
      emit({ type: "state", state });
    }
  };
  const noop = () => undefined;
  return {
    get state() {
      return state;
    },
    get time() {
      return time;
    },
    progress,
    soundLog: [],
    play() {
      frame();
      return new Promise<void>(noop);
    },
    seek(t: number) {
      time = 0;
      frame();
      while (time < t) {
        time = Math.min(t, time + 100);
        frame();
      }
    },
    pause: noop,
    resume: noop,
    setSpeed: noop,
    setSound: noop,
    setFollow: noop,
    replay: noop,
    goLive: noop,
    destroy: noop,
    on(type, fn) {
      const set = listeners.get(type) ?? new Set<Listener>();
      listeners.set(type, set);
      set.add(fn as Listener);
      return () => set.delete(fn as Listener);
    },
    eta: () => (state === "intro" || state === "building" ? (END - time) * 0.6 : 0),
    ready: async () => undefined,
  };
}

function sessionWith(player: Player, onPhase: (phase: SessionPhase) => void = () => undefined): Session {
  const services = { createPlayer: () => player } as unknown as StudioServices;
  const session = new Session({
    services,
    host: document.createElement("div"),
    ref: { kind: "example", id: "x" },
    local: null,
    settings: DEFAULT_SETTINGS,
    locale: "en",
    scheme: "light",
    onPhase,
  });
  session.loaded = {
    blueprint: { version: 1, source: { type: "html" }, size: { w: 800, h: 600 }, background: "#fff", layers: [] },
  };
  return session;
}

afterEach(() => vi.restoreAllMocks());

describe("Session", () => {
  it("keeps playing through non-fatal player errors and reaches done", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const phases: SessionPhase[] = [];
    const session = sessionWith(reportingPlayer(), (phase) => phases.push(phase));

    session.rebuild(true);
    await Promise.resolve();

    expect(phases).toEqual(["ready", "playing", "done"]);
    expect(warn).toHaveBeenCalledOnce();
    session.destroy();
  });

  it("seeks the right end of the scrubber to the end of the build when eta() fell short", () => {
    const player = slowPlayer();
    const session = sessionWith(player);
    session.rebuild(true);
    expect(session.plannedMs).toBe(18_000); // the early estimate: 40% short of the real 30 s

    expect(session.seek(1)).toBe(true);
    expect(player.progress.built).toBe(100);
    expect(player.state).toBe("finale");
    expect(session.plannedMs).toBe(30_000); // measured when the finale started

    session.seek(0.5);
    expect(player.time).toBe(15_000);
    session.destroy();
  });
});
