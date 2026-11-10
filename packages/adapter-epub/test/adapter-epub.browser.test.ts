import type { AdapterContext } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import bookUrl from "../../../examples/epub/loom-notes.epub?url";
import {
  allText,
  fixture,
  images,
  kinds,
  snapshotHtmlForTests,
  vectors,
  wellFormed,
} from "../../adapter-odf/test/support/snapshot";
import { createEpubAdapter } from "../src/index";

const ctx: AdapterContext = { document, width: 900, theme: "light" };

afterEach(() => {
  expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
});

describe("epub adapter on examples/epub", () => {
  it("weaves the cover and chapters of loom-notes.epub as page sheets", async () => {
    const adapter = createEpubAdapter({ snapshotHtml: await snapshotHtmlForTests() });
    const loaded = await adapter.load({ name: "loom-notes.epub", bytes: await fixture(bookUrl) }, ctx);
    const bp = loaded.blueprint;
    expect(wellFormed(bp)).toEqual([]);
    expect(bp.source).toMatchObject({ type: "epub", name: "loom-notes.epub", title: "Loom Notes" });
    // Cover sheet plus three chapters; the cover.xhtml wrapper is not repeated.
    const pages = bp.layers.filter((l) => l.role === "page");
    expect(pages).toHaveLength(4);
    expect(pages[0]?.box.h ?? 0).toBeGreaterThan(pages[0]?.box.w ?? 0);
    expect(kinds(bp)).toEqual(expect.arrayContaining(["box", "text", "image"]));
    // The inline SVG of chapter 3.
    expect(vectors(bp).length).toBeGreaterThan(0);
    const text = allText(bp);
    for (const s of ["Warp and Weft", "Counting threads", "Twill 2/2", "织机笔记", "Weave slowly, finish patiently."])
      expect(text).toContain(s);
    expect(text).not.toContain("never run");
    // Cover and figure come from the archive; nothing is loaded from elsewhere.
    expect(images(bp, "blob:").length).toBeGreaterThanOrEqual(2);
    for (const src of bp.layers.map((l) => (l.kind === "image" && "src" in l ? l.src : "blob:")))
      expect(src).toMatch(/^(?:blob:|data:image\/svg\+xml)/);
    expect(bp.css ?? "").not.toContain("example.invalid");
    expect(loaded.notes?.[0]).toBe("Outline: Warp and Weft / Counting threads / 织机笔记 / Finishing.");
    expect(loaded.notes).toContain("Scripts in the book were not run.");
    expect(loaded.notes?.join(" ")).toContain("Calibri -> Carlito");
    loaded.dispose?.();
  }, 30_000);
});
