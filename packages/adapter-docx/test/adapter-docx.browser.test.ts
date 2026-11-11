import type { Blueprint, BoxLayer, Layer, TextLayer } from "@swarmloom/core";
import * as snapshotDom from "@swarmloom/snapshot-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { type DocxLoadedSource, loadDocx } from "../src/index";
import { createSandbox, DESK, PAGE_GAP } from "../src/paged/index";
import { fakeSnapshotHtml, type SnapshotCall } from "./fake-snapshot";

const SAMPLE = new URL("../../../examples/docx/report.docx", import.meta.url);

async function sampleBytes(): Promise<Uint8Array> {
  const res = await fetch(SAMPLE);
  expect(res.ok).toBe(true);
  return new Uint8Array(await res.arrayBuffer());
}

const pagesOf = (bp: Blueprint) =>
  bp.layers
    .filter((l): l is BoxLayer => l.kind === "box" && l.role === "page")
    .sort((a, b) => Number(a.meta?.page) - Number(b.meta?.page));
const textsOf = (bp: Blueprint) => bp.layers.filter((l): l is TextLayer => l.kind === "text");
const allText = (bp: Blueprint) =>
  textsOf(bp)
    .map((t) => t.text)
    .join("\n");

/** Every text layer hangs (directly or through ancestors) under a page layer. */
function pageOf(bp: Blueprint, layer: Layer): string | undefined {
  const byId = new Map(bp.layers.map((l) => [l.id, l]));
  let current: Layer | undefined = layer;
  for (let hops = 0; current && hops < 64; hops++) {
    if (current.role === "page") return current.id;
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return undefined;
}

describe.each(["preview", "plain"] as const)("DOCX sample with the %s renderer", (renderer) => {
  let loaded: DocxLoadedSource;
  const calls: SnapshotCall[] = [];

  beforeAll(async () => {
    const bytes = await sampleBytes();
    loaded = await loadDocx(
      { name: "report.docx", bytes },
      { document, width: 1000, theme: "light" },
      { renderer, snapshotHtml: fakeSnapshotHtml(calls) },
    );
  }, 60_000);

  it("pages at the explicit break and the section start only", () => {
    expect(loaded.renderer).toBe(renderer);
    expect(loaded.pages).toBe(3);
    const pages = pagesOf(loaded.blueprint);
    expect(pages.map((p) => p.meta?.page)).toEqual([1, 2, 3]);
    const [first, second, third] = pages as [BoxLayer, BoxLayer, BoxLayer];
    // Stacked vertically with the desk gap, centred, landscape sheet wider.
    expect(second.box.y - (first.box.y + first.box.h)).toBeCloseTo(PAGE_GAP, 0);
    expect(third.box.y - (second.box.y + second.box.h)).toBeCloseTo(PAGE_GAP, 0);
    expect(third.box.w).toBeGreaterThan(first.box.w);
    expect(Math.abs(first.box.x + first.box.w / 2 - 500)).toBeLessThan(2);
    expect(first.box.w).toBeGreaterThan(780);
  });

  it("puts every text layer on a page, after its page in build order", () => {
    const bp = loaded.blueprint;
    const texts = textsOf(bp);
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) expect(pageOf(bp, text)).toBeDefined();
    const firstPage = pagesOf(bp)[0];
    const onFirst = texts.filter((t) => pageOf(bp, t) === firstPage.id).map((t) => t.text);
    expect(onFirst.join(" ")).toContain("Overview");
  });

  it("keeps the document text, headings and title", () => {
    const bp = loaded.blueprint;
    const text = allText(bp);
    for (const s of ["SwarmLoom Weave Report", "Overview", "Highlights", "Warp and weft", "Appendix"]) {
      expect(text).toContain(s);
    }
    expect(textsOf(bp).some((t) => t.role === "heading" && t.text.includes("Metrics"))).toBe(true);
    expect(bp.source).toMatchObject({ type: "docx", name: "report.docx", title: "SwarmLoom Weave Report" });
    expect(bp.background).toBe(DESK.light);
    expect(bp.icon).toMatch(/^data:image\/svg\+xml/);
  });

  it("shows each footnote once, repeats linked headers and numbers the footers", () => {
    const texts = textsOf(loaded.blueprint);
    const note = texts.filter((t) => t.text.includes("All figures are for demonstration only."));
    const headers = texts.filter((t) => t.text.includes("SwarmLoom · 群织"));
    if (renderer === "preview") {
      expect(note).toHaveLength(1);
      expect(headers).toHaveLength(3);
      // The footer's PAGE field saved "1"; every sheet shows its own number.
      const html = new DOMParser().parseFromString(calls[0].html, "text/html");
      const footers = Array.from(html.querySelectorAll("footer"), (f) => f.textContent?.replace(/\s+/g, " ").trim());
      expect(footers).toEqual(["第 1 页 · Page", "第 2 页 · Page", "第 3 页 · Page"]);
    } else {
      // The simplified view leaves notes, headers and footers out (and says so).
      expect(note).toHaveLength(0);
      expect(loaded.notes.some((n) => n.includes("headers and footers"))).toBe(true);
    }
  });

  it("hands snapshot-dom safe HTML at the layout width", () => {
    expect(calls).toHaveLength(1);
    const { html, opts } = calls[0];
    expect(opts.width).toBe(1000);
    expect(html).not.toMatch(/<script|<iframe|\son[a-z]+=/i);
    expect(opts.css ?? "").not.toMatch(/@import|url\(\s*['"]?https?:/i);
    expect(html).toMatch(/role="heading" aria-level="1"|<h1/);
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });

  it("turns list numbering into real text", () => {
    if (renderer === "preview") expect(calls[0].html).toContain("swl-marker");
    expect(allText(loaded.blueprint)).toMatch(/(^|\n)(1\.|•)/);
  });

  it("sets unstyled paragraphs in the Normal style's font, not the document default", () => {
    if (renderer !== "preview") return;
    const sandbox = createSandbox(document, 1000);
    try {
      sandbox.addCss(calls[0].opts.css ?? "");
      sandbox.root.innerHTML = calls[0].html;
      const run = Array.from(sandbox.root.querySelectorAll("span")).find((s) => s.textContent === "rebuilds");
      expect(run && getComputedStyle(run).fontFamily).toMatch(/^Calibri\b/);
    } finally {
      sandbox.dispose();
    }
  });
});

describe("DOCX layout options", () => {
  let bytes: Uint8Array;
  beforeAll(async () => {
    bytes = await sampleBytes();
  });

  it("narrows sheets on small screens instead of overflowing", async () => {
    const loaded = await loadDocx(
      { bytes },
      { document, width: 360, theme: "dark" },
      { snapshotHtml: fakeSnapshotHtml() },
    );
    const pages = pagesOf(loaded.blueprint);
    expect(pages).toHaveLength(3);
    for (const page of pages) expect(page.box.x + page.box.w).toBeLessThanOrEqual(360 - 11);
    expect(loaded.blueprint.background).toBe(DESK.dark);
  }, 60_000);

  it("reports font substitutions as notes", async () => {
    const loaded = await loadDocx(
      { bytes },
      { document, width: 900, theme: "light" },
      { snapshotHtml: fakeSnapshotHtml() },
    );
    for (const note of loaded.notes) expect(note).toMatch(/^[A-Z].*\.$/);
    const fonts = loaded.notes.find((n) => n.startsWith("Fonts not installed"));
    if (fonts) expect(fonts).toMatch(/→/);
  }, 60_000);
});

const realSnapshotHtml = (snapshotDom as unknown as { snapshotHtml?: unknown }).snapshotHtml;

describe.skipIf(typeof realSnapshotHtml !== "function")("DOCX through the real snapshot-dom", () => {
  it("builds page layers that contain the content", async () => {
    const loaded = await loadDocx(
      { name: "report.docx", bytes: await sampleBytes() },
      { document, width: 1000, theme: "light" },
    );
    const bp = loaded.blueprint;
    const pages = pagesOf(bp);
    expect(pages).toHaveLength(3);
    const texts = textsOf(bp);
    expect(texts.length).toBeGreaterThan(10);
    expect(texts.filter((t) => pageOf(bp, t) !== undefined).length).toBe(texts.length);
    expect(allText(bp)).toContain("Overview");
  }, 60_000);
});
