import { describe, expect, it } from "vitest";
import { codeAdapter } from "../src/index";

describe("@swarmloom/adapter-code", () => {
  it.each([["code", codeAdapter]])("%s adapter is a stub with metadata", async (id, adapter) => {
    expect(adapter.id).toBe(id);
    expect(adapter.extensions.length).toBeGreaterThan(0);
    await expect(adapter.load({}, { document, width: 800, theme: "light" })).rejects.toThrow("not implemented yet");
  });
});
