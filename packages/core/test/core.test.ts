import { describe, expect, it } from "vitest";
import type { Blueprint } from "../src/index";
import { createI18n, createPlayer, definePlugin, encodeWav, LOCALES, quantize, renderOffline } from "../src/index";

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

  it("still rejects createPlayer until the engine lands", () => {
    expect(() => createPlayer({ blueprint })).toThrow("not implemented yet");
  });
});
