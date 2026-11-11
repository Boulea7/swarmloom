import type { Player, PlayerEvent } from "@swarmloom/core";
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

afterEach(() => vi.restoreAllMocks());

describe("Session", () => {
  it("keeps playing through non-fatal player errors and reaches done", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const phases: SessionPhase[] = [];
    const services = { createPlayer: () => reportingPlayer() } as unknown as StudioServices;
    const session = new Session({
      services,
      host: document.createElement("div"),
      ref: { kind: "example", id: "x" },
      local: null,
      settings: DEFAULT_SETTINGS,
      locale: "en",
      scheme: "light",
      onPhase: (phase) => phases.push(phase),
    });
    session.loaded = {
      blueprint: { version: 1, source: { type: "html" }, size: { w: 800, h: 600 }, background: "#fff", layers: [] },
    };

    session.rebuild(true);
    await Promise.resolve();

    expect(phases).toEqual(["ready", "playing", "done"]);
    expect(warn).toHaveBeenCalledOnce();
    session.destroy();
  });
});
