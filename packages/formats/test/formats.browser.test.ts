import { describe, expect, it } from "vitest";
import { fetchSource, formats, load } from "../src/index";

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

  it("opens RTF saved with a .doc name with the RTF reader, not the DOC reader (F02)", async () => {
    const rtf = new TextEncoder().encode(
      "\ufeff{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0 Hello from RTF\\par}",
    );
    const loaded = await load({ name: "letter.doc", bytes: rtf }, { document, width: 800, theme: "light" });
    try {
      expect(loaded.blueprint.source).toMatchObject({ type: "rtf", name: "letter.doc" });
      expect(JSON.stringify(loaded.blueprint.layers)).toContain("Hello from RTF");
    } finally {
      loaded.dispose?.();
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
