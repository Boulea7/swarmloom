import { describe, expect, it } from "vitest";
import type { Blueprint } from "../src/index";
import {
  createI18n,
  createPlayer,
  definePlugin,
  encodeWav,
  LOCALES,
  quantize,
  renderOffline,
  VirtualClock,
} from "../src/index";

const blueprint: Blueprint = {
  version: 1,
  source: { type: "test" },
  size: { w: 100, h: 100 },
  background: "#fff",
  layers: [],
};

describe("@swarmloom/core public index", () => {
  it("exports the sound and i18n entry points of their zones", async () => {
    const plugin = { name: "demo" };
    expect(definePlugin(plugin)).toBe(plugin);
    expect(quantize(1001, 120)).toBe(1250);
    expect(LOCALES).toContain("zh-CN");
    expect(createI18n("fr-CA").locale).toBe("fr");
    // happy-dom has no Web Audio: offline rendering reports that instead of failing obscurely.
    await expect(renderOffline([], 100)).rejects.toThrow("OfflineAudioContext");
    expect(() => encodeWav({} as AudioBuffer)).toThrow(TypeError);
  });

  // The capture heuristics change with the capture: they live in the internal subpath, so they are
  // no semver promise and stay out of the CDN build, which inlines this whole index.
  it("keeps the animation-start heuristics out of the public index", async () => {
    const index: Record<string, unknown> = await import("../src/index");
    expect(Object.keys(index).filter((name) => /StyleFacts|StartAnimations/.test(name))).toEqual([]);
  });

  it("createPlayer rejects a malformed blueprint without mounting anything", () => {
    const host = document.body.appendChild(document.createElement("div"));
    expect(() => createPlayer({ blueprint: { ...blueprint, version: 2 } as never, host })).toThrow(TypeError);
    expect(host.childNodes).toHaveLength(0);
    host.remove();
  });

  it("the toolbar's finish key completes a real build within about a second", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const clock = new VirtualClock();
    const layers = Array.from({ length: 24 }, (_, i) => ({
      id: `line${i}`,
      kind: "text" as const,
      box: { x: 10, y: 10 + i * 30, w: 300, h: 20 },
      html: "Woven line",
      text: "Woven line",
      style: {},
    }));
    const player = createPlayer({
      blueprint: { ...blueprint, size: { w: 400, h: 800 }, layers },
      host,
      clock,
      sound: false,
    });
    void player.play();
    for (let i = 0; i < 180; i++) clock.advance(1000 / 60);
    expect(player.state).toBe("building");
    expect(player.progress.built).toBeLessThan(24);
    // Keys reach the toolbar through the stage element (its shadow root is closed).
    const stage = host.firstElementChild;
    stage?.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, composed: true, cancelable: true }));
    for (let i = 0; i < 75; i++) clock.advance(1000 / 60);
    expect(player.progress).toEqual({ built: 24, total: 24 });
    expect(player.state).toBe("finale");
    player.destroy();
    host.remove();
  });

  it("createPlayer plays a tiny blueprint to done under a VirtualClock", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const clock = new VirtualClock();
    const tiny: Blueprint = {
      ...blueprint,
      layers: [
        { id: "card", kind: "box", box: { x: 10, y: 10, w: 80, h: 40 }, style: { background: "#5b5bf7" } },
        { id: "label", kind: "text", box: { x: 14, y: 60, w: 70, h: 20 }, html: "Hi", text: "Hi", style: {} },
      ],
    };
    const player = createPlayer({ blueprint: tiny, host, clock, seed: 3, sound: false, controls: false });
    void player.play();
    for (let i = 0; i < 6000 && player.state !== "done"; i++) clock.advance(1000 / 60);
    expect(player.state).toBe("done");
    player.destroy();
    expect(player.state).toBe("destroyed");
    host.remove();
  });
});
