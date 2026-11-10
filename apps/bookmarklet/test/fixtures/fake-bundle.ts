/**
 * Test double of the hosted bundle (src/swarm.ts) for bookmarklet.browser.test.ts: the real boot
 * and controller with a fake snapshot and a fake player, so the browser test covers
 * loader -> module script -> boot -> controller without depending on the engine.
 *
 * Every player it creates is recorded in `window.__bmTest.players`.
 */
import type { Blueprint, Player, PlayerOptions, PlayerState } from "@swarmloom/core";
import { bootBookmarklet } from "../../src/bundle/boot";

/** What the test reads back about one fake player. */
export interface FakePlayerRecord {
  options: PlayerOptions;
  destroyed: boolean;
}

declare global {
  interface Window {
    __bmTest?: { players: FakePlayerRecord[] };
  }
}

function fakeSnapshot(root: Document): Promise<Blueprint> {
  return Promise.resolve({
    version: 1,
    source: { type: "dom", url: root.URL, title: root.title },
    size: { w: root.defaultView?.innerWidth ?? 800, h: 600 },
    background: "#fff",
    layers: [],
  });
}

/** A player that stays "building" until destroyed and shows a marker element meanwhile. */
function fakePlayer(options: PlayerOptions): Player {
  const record: FakePlayerRecord = { options, destroyed: false };
  window.__bmTest ??= { players: [] };
  window.__bmTest.players.push(record);
  const overlay = document.createElement("div");
  overlay.dataset.fakeOverlay = "";
  document.documentElement.append(overlay);
  let state: PlayerState = "building";
  return {
    get state() {
      return state;
    },
    progress: { built: 0, total: 1 },
    soundLog: [],
    play: () => new Promise<void>(() => {}),
    pause() {},
    resume() {},
    setSpeed() {},
    setSound() {},
    setFollow() {},
    replay() {},
    goLive() {},
    destroy() {
      state = "destroyed";
      record.destroyed = true;
      overlay.remove();
    },
    on: () => () => {},
    eta: () => 0,
    ready: () => Promise.resolve(),
  };
}

// Not a literal: Vite rewrites `new URL("literal", import.meta.url)` against `self.location`, which is
// about:srcdoc in the test pages.
const studioPath = "./studio.html?from=bookmarklet";

bootBookmarklet({
  win: window,
  doc: document,
  snapshot: fakeSnapshot,
  createPlayer: fakePlayer,
  studioUrl: new URL(studioPath, import.meta.url),
});
