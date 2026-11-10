import type { Blueprint, Player, PlayerOptions, PlayerState } from "@swarmloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ControllerDeps, createController } from "../src/bundle/controller";
import { NOTICE_ID } from "../src/bundle/notice";
import { MSG_PAGE } from "../src/protocol";

const blueprint: Blueprint = {
  version: 1,
  source: { type: "dom" },
  size: { w: 800, h: 600 },
  background: "#fff",
  layers: [],
};

/** Player that keeps building until destroyed. */
function fakePlayer(): Player & { options?: PlayerOptions } {
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
    destroy: vi.fn(() => {
      state = "destroyed";
    }),
    on: () => () => {},
    eta: () => 0,
    ready: () => Promise.resolve(),
  };
}

function deps(overrides: Partial<ControllerDeps>): ControllerDeps {
  return {
    win: window,
    doc: document,
    snapshot: () => Promise.resolve(blueprint),
    createPlayer: () => fakePlayer(),
    studioUrl: new URL("https://studio.example/studio/?from=bookmarklet"),
    ...overrides,
  };
}

afterEach(() => {
  document.getElementById(NOTICE_ID)?.remove();
  vi.restoreAllMocks();
});

describe("bookmarklet controller", () => {
  it("rebuilds in overlay mode with controls, then stops on the next toggle", async () => {
    const player = fakePlayer();
    const createPlayer = vi.fn((_options: PlayerOptions) => player);
    const handle = createController(deps({ createPlayer }));

    handle.toggle("speed=3&finale=halo");
    await vi.waitFor(() => expect(handle.state).toBe("running"));
    expect(createPlayer.mock.calls[0]?.[0]).toMatchObject({
      mode: "overlay",
      controls: true,
      speed: 3,
      finale: "halo",
    });
    // Without a seed option the seed derives from the page URL, so a page always replays the same way.
    expect(createPlayer.mock.calls[0]?.[0].seed).toEqual(expect.any(Number));

    handle.toggle();
    expect(handle.state).toBe("idle");
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it("ends the rebuild when the page is left", async () => {
    const player = fakePlayer();
    const handle = createController(deps({ createPlayer: () => player }));
    handle.toggle();
    await vi.waitFor(() => expect(handle.state).toBe("running"));

    // A history step that keeps the path (fragment or query only) is not leaving.
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(handle.state).toBe("running");
    window.dispatchEvent(new Event("pagehide"));
    expect(handle.state).toBe("idle");
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it("offers the Studio when the rebuild fails and hands the page over on request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const popup = { postMessage: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const handle = createController(deps({ snapshot: () => Promise.reject(new Error("boom")) }));

    handle.toggle();
    await vi.waitFor(() => expect(handle.state).toBe("failed"));
    const notice = document.getElementById(NOTICE_ID)?.shadowRoot;
    const studio = notice?.querySelector<HTMLButtonElement>("button.primary");
    expect(studio).toBeTruthy();
    studio?.click();

    expect(open).toHaveBeenCalledWith(new URL("https://studio.example/studio/?from=bookmarklet"));
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    window.dispatchEvent(new MessageEvent("message", { data: MSG_PAGE }));
    const [payload, origin] = popup.postMessage.mock.calls[0] ?? [];
    expect(origin).toBe("https://studio.example");
    expect(payload).toMatchObject({ type: MSG_PAGE, reason: "manual" });
    // The notice was closed before serializing, so the copy does not contain it.
    expect(payload.html).not.toContain(NOTICE_ID);
  });
});
