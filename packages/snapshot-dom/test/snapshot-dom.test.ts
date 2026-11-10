import { describe, expect, it } from "vitest";
import { domAdapter, snapshot } from "../src/index";

describe("@swarmloom/snapshot-dom", () => {
  it("exposes the dom adapter and a snapshot stub", async () => {
    expect(domAdapter.id).toBe("dom");
    await expect(snapshot(document)).rejects.toThrow("not implemented yet");
  });

  it("rejects input without an element", async () => {
    await expect(domAdapter.load({}, { document, width: 800, theme: "light" })).rejects.toThrow(TypeError);
  });
});
