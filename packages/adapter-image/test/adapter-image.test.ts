import { describe, expect, it } from "vitest";
import { imageAdapter } from "../src/index";

describe("@swarmloom/adapter-image", () => {
  it.each([["image", imageAdapter]])("%s adapter is a stub with metadata", async (id, adapter) => {
    expect(adapter.id).toBe(id);
    expect(adapter.extensions.length).toBeGreaterThan(0);
    await expect(adapter.load({}, { document, width: 800, theme: "light" })).rejects.toThrow("not implemented yet");
  });
});
