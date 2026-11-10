import type { Blueprint, BoxLayer, Layer, TextLayer } from "@swarmloom/core";
import * as snapshotDom from "@swarmloom/snapshot-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { fakeSnapshotHtml, type SnapshotCall } from "../../adapter-docx/test/fake-snapshot";
import { type DocLoadedSource, loadDoc, TEXT_MODE_NOTE } from "../src/index";

// Static URLs: Vite rewrites `new URL("literal", import.meta.url)` to served asset URLs.
const SAMPLES = {
  "doc/headers-footers-unicode.doc": new URL("../../../examples/doc/headers-footers-unicode.doc", import.meta.url),
  "doc/table.doc": new URL("../../../examples/doc/table.doc", import.meta.url),
  "doc/report.doc": new URL("../../../examples/doc/report.doc", import.meta.url),
  "docx/report.docx": new URL("../../../examples/docx/report.docx", import.meta.url),
};

async function fetchBytes(path: keyof typeof SAMPLES): Promise<Uint8Array> {
  const res = await fetch(SAMPLES[path]);
  expect(res.ok).toBe(true);
  return new Uint8Array(await res.arrayBuffer());
}

const ctx = { document, width: 900, theme: "light" as const };
const pagesOf = (bp: Blueprint) =>
  bp.layers
    .filter((l): l is BoxLayer => l.kind === "box" && l.role === "page")
    .sort((a, b) => Number(a.meta?.page) - Number(b.meta?.page));
const textsOf = (bp: Blueprint) => bp.layers.filter((l): l is TextLayer => l.kind === "text");

function pageOf(bp: Blueprint, layer: Layer): string | undefined {
  const byId = new Map(bp.layers.map((l) => [l.id, l]));
  let current: Layer | undefined = layer;
  for (let hops = 0; current && hops < 64; hops++) {
    if (current.role === "page") return current.id;
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return undefined;
}

describe("DOC sample in text mode", () => {
  let loaded: DocLoadedSource;
  const calls: SnapshotCall[] = [];

  beforeAll(async () => {
    const bytes = await fetchBytes("doc/headers-footers-unicode.doc");
    loaded = await loadDoc({ name: "headers-footers-unicode.doc", bytes }, ctx, {
      snapshotHtml: fakeSnapshotHtml(calls),
    });
  }, 60_000);

  it("builds two page layers from the explicit page break", () => {
    expect(loaded.view).toBe("text");
    expect(loaded.pages).toBe(2);
    const pages = pagesOf(loaded.blueprint);
    expect(pages.map((p) => p.meta?.page)).toEqual([1, 2]);
    const [first, second] = pages as [BoxLayer, BoxLayer];
    expect(second.box.y).toBeGreaterThan(first.box.y + first.box.h);
    expect(first.box.w).toBeGreaterThan(700);
    expect(first.box.x + first.box.w).toBeLessThanOrEqual(900 - 32);
  });

  it("puts the text on its pages", () => {
    const bp = loaded.blueprint;
    const [first, second] = pagesOf(bp) as [BoxLayer, BoxLayer];
    const on = (page: BoxLayer) =>
      textsOf(bp)
        .filter((t) => pageOf(bp, t) === page.id)
        .map((t) => t.text)
        .join("\n");
    expect(on(first)).toContain("Molière");
    expect(on(first)).toContain("This is a simple header, with a € euro symbol in it.");
    expect(on(first)).toContain("The footer, with Molière, has Unicode in it.");
    expect(on(second)).toContain("This is page two.");
    expect(on(second)).toContain("Les Précieuses ridicules.");
    expect(on(first)).not.toContain("This is page two.");
    for (const text of textsOf(bp)) expect(pageOf(bp, text)).toBeDefined();
    expect(textsOf(bp).some((t) => t.role === "heading" && t.text.includes("Molière"))).toBe(true);
  });

  it("reports text mode and keeps the HTML free of pictures and inline character styles", () => {
    expect(loaded.notes[0]).toBe(TEXT_MODE_NOTE);
    const { html, opts } = calls[0]!;
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<script|<iframe/i);
    expect(opts.width).toBe(900);
    expect(loaded.blueprint.source).toMatchObject({ type: "doc", title: "Molière" });
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });
});

describe("other DOC inputs", () => {
  it("renders the table sample", async () => {
    const calls: SnapshotCall[] = [];
    const loaded = await loadDoc({ name: "table.doc", bytes: await fetchBytes("doc/table.doc") }, ctx, {
      snapshotHtml: fakeSnapshotHtml(calls),
    });
    expect(loaded.pages).toBe(1);
    expect(calls[0]!.html).toMatch(/<table[^>]*swl-doc-table/);
    expect(textsOf(loaded.blueprint).length).toBeGreaterThan(20);
  }, 60_000);

  it("renders the generated report sample on three sheets, the last one landscape", async () => {
    const calls: SnapshotCall[] = [];
    const loaded = await loadDoc({ name: "report.doc", bytes: await fetchBytes("doc/report.doc") }, ctx, {
      snapshotHtml: fakeSnapshotHtml(calls),
    });
    const pages = pagesOf(loaded.blueprint);
    expect(pages).toHaveLength(3);
    expect(pages[2]!.box.w).toBeGreaterThan(pages[0]!.box.w);
    const bp = loaded.blueprint;
    expect(bp.source.title).toBe("群织旧版文档样例 · SwarmLoom Legacy DOC Sample");
    const all = textsOf(bp)
      .map((t) => t.text)
      .join("\n");
    expect(all).toContain("MS-DOC");
    // The header of the first section repeats on every sheet, the landscape one included.
    expect(textsOf(bp).filter((t) => t.text.trim() === "群织 SwarmLoom · 旧版 Word 样例").length).toBe(3);
    expect(calls[0]!.html).toMatch(/<table[^>]*swl-doc-table/);
  }, 60_000);

  it("renders rich mode with character formatting", async () => {
    const calls: SnapshotCall[] = [];
    const loaded = await loadDoc({ bytes: await fetchBytes("doc/headers-footers-unicode.doc") }, ctx, {
      mode: "rich",
      snapshotHtml: fakeSnapshotHtml(calls),
    });
    expect(loaded.view).toBe("rich");
    expect(loaded.notes).not.toContain(TEXT_MODE_NOTE);
    expect(pagesOf(loaded.blueprint)).toHaveLength(2);
    expect(calls[0]!.html).toMatch(/font-weight:\s*700/);
  }, 60_000);

  it("opens a Word 2007+ package saved with a .doc name through the DOCX adapter", async () => {
    const loaded = await loadDoc({ name: "renamed.doc", bytes: await fetchBytes("docx/report.docx") }, ctx, {
      snapshotHtml: fakeSnapshotHtml(),
    });
    expect(loaded.view).toBe("docx");
    expect(loaded.notes[0]).toMatch(/opened as \.docx/);
    expect(loaded.blueprint.source.type).toBe("docx");
    expect(pagesOf(loaded.blueprint).length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

const realSnapshotHtml = (snapshotDom as unknown as { snapshotHtml?: unknown }).snapshotHtml;

describe.skipIf(typeof realSnapshotHtml !== "function")("DOC through the real snapshot-dom", () => {
  it("builds page layers that contain the content", async () => {
    const loaded = await loadDoc({ bytes: await fetchBytes("doc/headers-footers-unicode.doc") }, ctx);
    const bp = loaded.blueprint;
    expect(pagesOf(bp)).toHaveLength(2);
    const texts = textsOf(bp);
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.filter((t) => pageOf(bp, t) !== undefined).length).toBe(texts.length);
  }, 60_000);

  it("pages the generated report sample", async () => {
    const loaded = await loadDoc({ bytes: await fetchBytes("doc/report.doc") }, ctx);
    const bp = loaded.blueprint;
    expect(pagesOf(bp)).toHaveLength(3);
    const texts = textsOf(bp);
    expect(texts.filter((t) => pageOf(bp, t) !== undefined).length).toBe(texts.length);
  }, 60_000);
});
