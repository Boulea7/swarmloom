import type { Blueprint, Player, PlayerEvent, PlayerOptions, PlayerState } from "@swarmloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { goLiveSession, readSessionState, stopRunningSession } from "../src/background/injected";
import { type SessionDeps, startSession, toggleSession } from "../src/content/session";
import { UI_TAG } from "../src/content/ui";
import { GLOBALS, parseLaunch } from "../src/shared/messages";

const blueprint = { version: 1, layers: [{ id: "a" }] } as unknown as Blueprint;

/** Minimal player: records calls and lets the test drive state changes. */
function fakePlayer(options: PlayerOptions) {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const player = {
    state: "idle" as PlayerState,
    destroyed: 0,
    options,
    on(type: PlayerEvent["type"], fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      return () =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((f) => f !== fn),
        );
    },
    emit(state: PlayerState) {
      player.state = state;
      for (const fn of listeners.get("state") ?? []) fn({ type: "state", state });
    },
    play: vi.fn(async () => player.emit("building")),
    goLive: vi.fn(() => options.onLive?.()),
    destroy() {
      player.destroyed++;
      listeners.clear();
    },
    listenerCount: () => [...listeners.values()].flat().length,
  };
  return player;
}

function deps(over: Partial<SessionDeps> = {}) {
  const players: ReturnType<typeof fakePlayer>[] = [];
  const d: SessionDeps = {
    snapshot: vi.fn(async () => blueprint),
    createPlayer: (options) => {
      const p = fakePlayer(options);
      players.push(p);
      return p as unknown as Player;
    },
    capturePoster: vi.fn(async () => null),
    openStudio: vi.fn(),
    audioAvailable: () => true,
    ...over,
  };
  return { d, players };
}

const launch = parseLaunch({ kind: "page", capture: true, locale: "en" });
const uiHosts = () => document.documentElement.querySelectorAll(UI_TAG).length;

afterEach(() => {
  stopRunningSession();
  for (const key of Object.values(GLOBALS)) delete (globalThis as Record<string, unknown>)[key];
  document.body.innerHTML = "";
});

describe("swarm session", () => {
  it("plays, follows player state and goes live by restoring the page", async () => {
    document.body.innerHTML = "<main><h1>Hello</h1></main>";
    const before = document.documentElement.outerHTML;
    const { d, players } = deps();
    const session = startSession(globalThis, document, launch, d);
    expect(uiHosts()).toBe(1);
    await session.ready;

    const player = players[0];
    if (!player) throw new Error("player was not created");
    expect(d.capturePoster).toHaveBeenCalledOnce();
    expect(player.options).toMatchObject({ mode: "overlay", blueprint });
    expect(readSessionState()).toEqual({ phase: "building", error: null });
    player.emit("done");
    expect(session.phase).toBe("done");

    expect(goLiveSession()).toBe(true);
    expect(session.phase).toBe("closed");
    expect(player.destroyed).toBe(1);
    expect(readSessionState()).toBeNull();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("shows an error panel with next steps when nothing could be captured", async () => {
    const { d, players } = deps({ snapshot: async () => ({ ...blueprint, layers: [] }) });
    const session = startSession(globalThis, document, launch, d);
    await session.ready;
    expect(players).toHaveLength(0);
    expect(session.phase).toBe("error");
    const host = document.querySelector(UI_TAG);
    expect(host?.hasAttribute("data-swarmloom-ignore")).toBe(true);

    // Esc on the panel dismisses everything.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(session.phase).toBe("closed");
    expect(uiHosts()).toBe(0);
  });

  it("reports snapshot failures and offers Studio", async () => {
    const { d } = deps({ snapshot: () => Promise.reject(new Error("boom")) });
    const session = startSession(globalThis, document, launch, d);
    await session.ready;
    expect(session).toMatchObject({ phase: "error", error: "boom" });
    expect(readSessionState()).toEqual({ phase: "error", error: "boom" });
  });

  it("toggles: a second start stops the running swarm and cleans up listeners", async () => {
    const { d, players } = deps();
    const first = toggleSession(globalThis, document, launch, d);
    await first?.ready;
    expect(toggleSession(globalThis, document, launch, d)).toBeNull();
    expect(first?.phase).toBe("closed");
    expect(players[0]?.destroyed).toBe(1);
    expect(players[0]?.listenerCount()).toBe(0);
    expect(uiHosts()).toBe(0);

    // Stopping while the snapshot is still running never creates a player.
    let release: (b: Blueprint) => void = () => undefined;
    const slow = deps({ snapshot: () => new Promise<Blueprint>((r) => (release = r)) });
    const pending = startSession(globalThis, document, launch, slow.d);
    await Promise.resolve();
    pending.stop();
    release(blueprint);
    await pending.ready;
    expect(slow.players).toHaveLength(0);
  });

  it("ends and restores the page when the page navigates, but not on anchor jumps (S03)", async () => {
    const view = window as unknown as { navigation?: EventTarget };
    const hadNavigation = "navigation" in view;
    if (!hadNavigation) view.navigation = new EventTarget();
    const navigate = (url: string) => Object.assign(new Event("navigate"), { destination: { url } });
    const here = location.href.split("#")[0];
    const cases: [string, () => void, boolean][] = [
      ["pagehide", () => window.dispatchEvent(new Event("pagehide")), true],
      ["route change", () => view.navigation?.dispatchEvent(navigate(new URL("/other", here).href)), true],
      ["anchor jump", () => view.navigation?.dispatchEvent(navigate(`${here}#lamps`)), false],
      ["popstate, same page", () => window.dispatchEvent(new Event("popstate")), false],
    ];
    try {
      for (const [name, act, ends] of cases) {
        const { d, players } = deps();
        const session = startSession(globalThis, document, launch, d);
        await session.ready;
        act();
        expect(session.phase === "closed", name).toBe(ends);
        expect(players[0]?.destroyed, name).toBe(ends ? 1 : 0);
        expect(uiHosts(), name).toBe(ends ? 0 : 1);
        session.stop();
      }
    } finally {
      if (!hadNavigation) delete view.navigation;
    }
  });
});
