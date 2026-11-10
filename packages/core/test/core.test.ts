import { describe, expect, it } from "vitest";
import type { Blueprint } from "../src/index";
import { createPlayer, definePlugin, encodeWav, renderOffline } from "../src/index";

const blueprint: Blueprint = {
  version: 1,
  source: { type: "test" },
  size: { w: 100, h: 100 },
  background: "#fff",
  layers: [],
};

describe("@swarmloom/core stubs", () => {
  it("definePlugin is the identity and pending APIs throw", async () => {
    const plugin = { name: "demo" };
    expect(definePlugin(plugin)).toBe(plugin);
    expect(() => createPlayer({ blueprint })).toThrow("not implemented yet");
    await expect(renderOffline([], 100)).rejects.toThrow("not implemented yet");
    expect(() => encodeWav({} as AudioBuffer)).toThrow("not implemented yet");
  });
});
