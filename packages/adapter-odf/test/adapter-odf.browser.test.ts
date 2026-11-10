import type { AdapterContext, Blueprint } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import budgetUrl from "../../../examples/odf/budget.ods?url";
import deckUrl from "../../../examples/odf/deck.odp?url";
import reportUrl from "../../../examples/odf/report.odt?url";
import { createOdfAdapter } from "../src/index";
import { allText, fixture, kinds, snapshotHtmlForTests, wellFormed } from "./support/snapshot";

const ctx: AdapterContext = { document, width: 1000, theme: "light" };
const sheets = (bp: Blueprint, role: string) => bp.layers.filter((l) => l.role === role);

async function load(url: string, name: string) {
  const adapter = createOdfAdapter({ snapshotHtml: await snapshotHtmlForTests() });
  return adapter.load({ name, bytes: await fixture(url) }, ctx);
}

afterEach(() => {
  expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
});

describe("odf adapter on examples/odf", () => {
  it("lays report.odt out as two A4 pages with text, a table and a picture", async () => {
    const loaded = await load(reportUrl, "report.odt");
    const bp = loaded.blueprint;
    expect(wellFormed(bp)).toEqual([]);
    expect(bp.source).toMatchObject({ type: "odf", name: "report.odt", title: "Field notes from the loom" });
    const pages = sheets(bp, "page");
    expect(pages).toHaveLength(2);
    expect(pages[0]?.box.w).toBeCloseTo(793.7, 0);
    expect(pages[0]?.box.h).toBeGreaterThanOrEqual(1122);
    expect(kinds(bp)).toEqual(new Set(["box", "text", "image"]));
    const text = allText(bp);
    for (const s of ["Field notes from the loom", "Plain weave", "群织让一群光标", "Page 2 of 2", "Second sheet"])
      expect(text).toContain(s);
    const image = bp.layers.find((l) => l.kind === "image");
    expect(image && "src" in image ? image.src : "").toMatch(/^blob:/);
    expect(loaded.notes?.[0]).toContain("Calibri -> Carlito");
    expect(loaded.notes?.[0]).toContain("SimSun -> Noto Serif SC");
    loaded.dispose?.();
  });

  it("draws budget.ods as grids with saved values, merged title and fills", async () => {
    const loaded = await load(budgetUrl, "budget.ods");
    const bp = loaded.blueprint;
    expect(wellFormed(bp)).toEqual([]);
    expect(sheets(bp, "page")).toHaveLength(2);
    expect(kinds(bp)).toEqual(new Set(["box", "text", "path"]));
    const text = allText(bp);
    for (const s of ["Loom budget, first half", "2,252", "2,534", "12.5%", "Made up for this sample."])
      expect(text).toContain(s);
    expect(bp.truncated).toBeUndefined();
    expect(loaded.notes).toContain("Cells show their saved values; formulas are not recalculated.");
  });

  it("builds deck.odp as 16:9 slides with frames, shapes and a picture", async () => {
    const loaded = await load(deckUrl, "deck.odp");
    const bp = loaded.blueprint;
    expect(wellFormed(bp)).toEqual([]);
    const slides = sheets(bp, "slide");
    expect(slides).toHaveLength(2);
    expect((slides[0]?.box.w ?? 0) / (slides[0]?.box.h ?? 1)).toBeCloseTo(16 / 9, 2);
    expect(kinds(bp)).toEqual(new Set(["box", "text", "path", "image"]));
    const text = allText(bp);
    for (const s of ["SwarmLoom", "How the loom works", "Place frames, shapes and pictures", "Warp", "Weft"])
      expect(text).toContain(s);
    // Master-page placeholders are prompts, not content.
    expect(text).not.toContain("Click to add");
  });
});
