/// <reference types="vite/client" />
import type { AdapterContext, Blueprint, Layer, TextLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import citiesUrl from "../../../examples/sheet/cities.csv?url";
import salesUrl from "../../../examples/sheet/sales.xlsx?url";
import pitchUrl from "../../../examples/slides/pitch.pptx?url";
import { createSheetAdapter, createSlidesAdapter, OfficeFormatError, sheetAdapter, slidesAdapter } from "../src/index";

async function fixture(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return new Uint8Array(await response.arrayBuffer());
}

const ctx = (extra: Partial<AdapterContext> = {}): AdapterContext => ({
  document,
  width: 1200,
  theme: "light",
  ...extra,
});

const texts = (bp: Blueprint): TextLayer[] => bp.layers.filter((l): l is TextLayer => l.kind === "text");

/** Structural checks every Blueprint must pass: unique ids, parents declared first, finite boxes. */
function expectWellFormed(bp: Blueprint): void {
  const seen = new Set<string>();
  for (const layer of bp.layers) {
    expect(seen.has(layer.id), `duplicate id ${layer.id}`).toBe(false);
    if (layer.parent) expect(seen.has(layer.parent), `${layer.id} parent ${layer.parent}`).toBe(true);
    seen.add(layer.id);
    for (const v of [layer.box.x, layer.box.y, layer.box.w, layer.box.h]) expect(Number.isFinite(v)).toBe(true);
    expect(layer.box.w).toBeGreaterThanOrEqual(0);
    expect(layer.box.h).toBeGreaterThanOrEqual(0);
  }
  for (const layer of bp.layers) {
    for (const snap of layer.snaps ?? []) expect(seen.has(snap), `${layer.id} snaps to ${snap}`).toBe(true);
  }
}

/** `text` must be exactly what the browser sees in `html`. */
function expectTextMatchesHtml(layer: TextLayer): void {
  const probe = document.createElement("div");
  probe.innerHTML = layer.html;
  expect(probe.querySelector("script,img,iframe,a")).toBeNull();
  expect(probe.textContent).toBe(layer.text);
}

describe("slides adapter on examples/slides/pitch.pptx", () => {
  it("builds one 16:9 slide box per slide, stacked vertically, with text, image and table layers", async () => {
    const loaded = await slidesAdapter.load({ name: "pitch.pptx", bytes: await fixture(pitchUrl) }, ctx());
    const bp = loaded.blueprint;
    expectWellFormed(bp);
    expect(bp.source.type).toBe("slides");
    expect(bp.truncated).toBeUndefined();

    const slides = bp.layers.filter((l) => l.role === "slide");
    expect(slides).toHaveLength(5);
    for (const [i, slide] of slides.entries()) {
      expect(slide.kind).toBe("box");
      expect(slide.box.w / slide.box.h).toBeCloseTo(16 / 9, 2);
      expect(slide.box.x + slide.box.w).toBeLessThanOrEqual(bp.size.w);
      const next = slides[i + 1];
      if (next) expect(next.box.y).toBeGreaterThan(slide.box.y + slide.box.h);
    }
    expect(bp.size.h).toBeGreaterThan((slides[4] as Layer).box.y + (slides[4] as Layer).box.h);

    // Every other layer hangs under a slide and stays inside it.
    const slideIds = new Set(slides.map((s) => s.id));
    const byId = new Map(bp.layers.map((l) => [l.id, l]));
    for (const layer of bp.layers) {
      if (layer.role === "slide") continue;
      let root: Layer | undefined = layer;
      while (root?.parent) root = byId.get(root.parent);
      expect(slideIds.has(root?.id ?? ""), layer.id).toBe(true);
    }

    const all = texts(bp);
    const title = all.find((t) => t.text === "SwarmLoom");
    expect(title?.role).toBe("heading");
    expect(title?.parent).toBe(slides[0]?.id);
    expect(all.some((t) => t.text.includes("Why SwarmLoom"))).toBe(true);
    expect(all.some((t) => t.role === "list")).toBe(true);
    for (const t of all) expectTextMatchesHtml(t);

    const image = bp.layers.find((l) => l.kind === "image");
    expect(image?.kind === "image" && image.src.startsWith("blob:")).toBe(true);
    const cells = all.filter((t) => t.role === "cell");
    expect(cells.map((c) => c.text)).toContain("Studio (PWA)");
    expect(cells).toHaveLength(8);
    // The theme font is reported with its open substitute (decisions F01); nothing is a placeholder.
    expect(loaded.notes).toEqual([expect.stringContaining("Calibri → Carlito")]);

    // dispose() releases the picture blob URLs.
    const src = image?.kind === "image" ? image.src : "";
    expect((await fetch(src)).ok).toBe(true);
    loaded.dispose?.();
    await expect(fetch(src)).rejects.toThrow();
  });

  it("drops slides beyond maxSlides and reports them", async () => {
    const adapter = createSlidesAdapter({ maxSlides: 2 });
    const loaded = await adapter.load({ name: "pitch.pptx", bytes: await fixture(pitchUrl) }, ctx({ theme: "dark" }));
    expect(loaded.blueprint.layers.filter((l) => l.role === "slide")).toHaveLength(2);
    expect(loaded.blueprint.truncated?.dropped).toBe(3);
    loaded.dispose?.();
  });

  it("rejects legacy and non-presentation input with a readable error", async () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(slidesAdapter.load({ name: "old.ppt", bytes: cfb }, ctx())).rejects.toThrow(/\.pptx/);
    await expect(slidesAdapter.load({ name: "x.pptx", bytes: await fixture(salesUrl) }, ctx())).rejects.toBeInstanceOf(
      OfficeFormatError,
    );
  });
});

describe("sheet adapter", () => {
  it("draws sales.xlsx as pages with grid paths first and typed cell text", async () => {
    const loaded = await sheetAdapter.load({ name: "sales.xlsx", bytes: await fixture(salesUrl) }, ctx());
    const bp = loaded.blueprint;
    expectWellFormed(bp);
    expect(loaded.notes).toEqual([expect.stringContaining("Calibri → Carlito")]);
    expect(bp.source.type).toBe("sheet");
    expect(bp.truncated).toBeUndefined();

    const pages = bp.layers.filter((l) => l.role === "page");
    expect(pages.map((p) => p.meta?.sheet)).toEqual(["Sales H1", "Notes"]);

    const cells = texts(bp).filter((t) => t.role === "cell");
    for (const c of cells) expectTextMatchesHtml(c);
    const region = cells.find((c) => c.text === "Region");
    expect(region?.meta?.header).toBe(true);
    expect(region?.reveal).toBe("type");
    const total = cells.find((c) => c.meta?.ref === "I24");
    expect(total?.text).toBe("39,894");
    expect(total?.style["text-align"]).toBe("right");

    // Grid lines of the first sheet are paths emitted before any of its cells; fills are boxes.
    const firstGrid = bp.layers.findIndex((l) => l.kind === "path" && l.id.includes("grid"));
    const firstCell = bp.layers.findIndex((l) => l.kind === "text" && l.role === "cell");
    expect(firstGrid).toBeGreaterThanOrEqual(0);
    expect(firstGrid).toBeLessThan(firstCell);
    expect(bp.layers.some((l) => l.kind === "box" && l.role === "cell")).toBe(true);
    // Cells are typed row by row.
    const rows = cells.filter((c) => c.meta?.sheet === "Sales H1").map((c) => Number(c.meta?.row));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it("draws cities.csv with a typed header row and numbers aligned right", async () => {
    const loaded = await sheetAdapter.load(
      { name: "cities.csv", type: "text/csv", bytes: await fixture(citiesUrl) },
      ctx(),
    );
    const bp = loaded.blueprint;
    expectWellFormed(bp);
    // CSV declares no fonts, so there is nothing to report.
    expect(loaded.notes).toBeUndefined();
    const cells = texts(bp).filter((t) => t.role === "cell");
    expect(cells).toHaveLength(13 * 5);
    expect(cells.filter((c) => c.meta?.header).map((c) => c.text)).toEqual([
      "City",
      "Country",
      "Population",
      "Area (km²)",
      "Water",
    ]);
    expect(cells.find((c) => c.text === "24870895")?.style["text-align"]).toBe("right");
    expect(cells.some((c) => c.text === 'Port Jackson, "the Harbour"')).toBe(true);
  });

  it("caps rows and reports truncation", async () => {
    const adapter = createSheetAdapter({ maxRows: 4, maxCols: 2 });
    const { blueprint: bp } = await adapter.load({ name: "cities.csv", bytes: await fixture(citiesUrl) }, ctx());
    expect(texts(bp).filter((t) => t.role === "cell")).toHaveLength(8);
    expect(bp.truncated?.dropped).toBe(13 * 5 - 8);
    expect(bp.truncated?.reason).toMatch(/4 of 13 rows/);
  });

  it("reads TSV text input and rejects legacy .xls", async () => {
    const { blueprint: bp } = await sheetAdapter.load({ name: "t.tsv", text: "a\tb\n1,5\t2" }, ctx());
    expect(texts(bp).map((t) => t.text)).toEqual(expect.arrayContaining(["a", "b", "1,5", "2"]));
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(sheetAdapter.load({ name: "old.xls", bytes: cfb }, ctx())).rejects.toThrow(/\.xlsx/);
  });
});
