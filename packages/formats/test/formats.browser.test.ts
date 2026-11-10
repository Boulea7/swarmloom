import { describe, expect, it } from "vitest";
import { fetchSource, formats } from "../src/index";

describe("registry (real browser)", () => {
  it("lazy-loads every adapter and matches its metadata", async () => {
    for (const entry of formats) {
      const adapter = await entry.loader();
      expect({ id: adapter.id, extensions: adapter.extensions, mime: adapter.mime }).toEqual({
        id: entry.id,
        extensions: entry.extensions,
        mime: entry.mime,
      });
    }
  });

  it("fetches blob: URLs into a SourceInput", async () => {
    const url = URL.createObjectURL(new Blob(["# Hi"], { type: "text/markdown" }));
    try {
      const input = await fetchSource(url);
      expect(input.type).toBe("text/markdown");
      expect(new TextDecoder().decode(input.bytes)).toBe("# Hi");
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});
