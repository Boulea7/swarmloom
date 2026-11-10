import type { AdapterContext } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import bookUrl from "../../../examples/epub/loom-notes.epub?url";
import { allText, fixture, kinds, snapshotHtmlForTests, wellFormed } from "../../adapter-odf/test/support/snapshot";
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
    expect(kinds(bp)).toEqual(new Set(["box", "text", "image", "path"]));
    const text = allText(bp);
    for (const s of ["Warp and Weft", "Counting threads", "Twill 2/2", "织机笔记", "Weave slowly, finish patiently."])
      expect(text).toContain(s);
    expect(text).not.toContain("never run");
    const images = bp.layers.filter((l) => l.kind === "image").map((l) => ("src" in l ? l.src : ""));
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const src of images) expect(src).toMatch(/^blob:/);
    expect(bp.css ?? "").not.toContain("example.invalid");
    expect(loaded.notes?.[0]).toBe("Outline: Warp and Weft / Counting threads / 织机笔记 / Finishing.");
    expect(loaded.notes).toContain("Scripts in the book were not run.");
    expect(loaded.notes?.join(" ")).toContain("Calibri -> Carlito");
    loaded.dispose?.();
  });
});
