import type { Blueprint, ImageLayer, Layer, Rect } from "@swarmloom/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPdfAdapter } from "../src/index";
import { resolveOptions } from "../src/options";
import { getRuntime } from "../src/runtime";

const SAMPLE = new URL("../../../examples/pdf/brochure.pdf", import.meta.url);

async function sampleBytes(): Promise<Uint8Array> {
  const res = await fetch(SAMPLE);
  expect(res.ok).toBe(true);
  return new Uint8Array(await res.arrayBuffer());
}

const ctx = { document, width: 800, theme: "light" as const };
const isImage = (l: Layer): l is ImageLayer => l.kind === "image";
const textCrops = (bp: Blueprint) => bp.layers.filter(isImage).filter((l) => l.meta?.part === "text");
const inside = (x: number, y: number, r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

describe("pdf adapter on the brochure sample", () => {
  let bytes: Uint8Array;
  let blueprint: Blueprint;
  let dispose: (() => void) | undefined;
  const errors = vi.fn();

  beforeAll(async () => {
    bytes = await sampleBytes();
    const spy = vi.spyOn(console, "error").mockImplementation(errors);
    window.addEventListener("error", errors);
    try {
      const loaded = await createPdfAdapter().load({ name: "brochure.pdf", bytes }, ctx);
      blueprint = loaded.blueprint;
      dispose = loaded.dispose;
    } finally {
      spy.mockRestore();
      window.removeEventListener("error", errors);
    }
  }, 60_000);

  afterAll(() => dispose?.());

  it("stacks scaled page sheets without console errors", () => {
    expect(errors).not.toHaveBeenCalled();
    expect(blueprint.source).toMatchObject({ type: "pdf", name: "brochure.pdf", title: "SwarmLoom field guide" });
    expect(blueprint.truncated).toBeUndefined();
    const pages = blueprint.layers.filter((l) => l.role === "page");
    expect(pages).toHaveLength(2);
    const [first, second] = pages as [Layer, Layer];
    expect(first.box.w).toBeLessThanOrEqual(800);
    expect(first.box.w).toBeGreaterThan(700);
    expect(second.box.y).toBeGreaterThan(first.box.y + first.box.h);
    expect(blueprint.size.h).toBeGreaterThan(second.box.y + second.box.h);
    expect(new Set(blueprint.layers.map((l) => l.id)).size).toBe(blueprint.layers.length);
  });

  it("turns text into typed crops that cover the text items", async () => {
    const crops = textCrops(blueprint);
    const all = crops.map((c) => c.meta?.text).join("\n");
    for (const s of [
      "SwarmLoom",
      "Watch a swarm of cursors weave it into being.",
      "pdf.js page bitmap",
      "Notes for authors",
    ]) {
      expect(all).toContain(s);
    }
    expect(crops.find((c) => c.meta?.text === "SwarmLoom")?.role).toBe("heading");
    expect(crops.every((c) => c.lines === 1)).toBe(true);
    expect(crops.find((c) => String(c.meta?.text).startsWith("Every cursor"))?.role).toBe("paragraph");
    expect(crops.find((c) => c.meta?.text === "example value")?.reveal).toBe("sweep");
    expect(crops.filter((c) => c.reveal === "type").length).toBeGreaterThan(40);
    // The sample's own footer must not call the whole file MIT: it embeds GPL v2 (font exception) and OFL fonts.
    const prose = all.replace(/\s+/g, " ");
    expect(prose).not.toMatch(/released under the MIT license/i);
    expect(prose).toContain("The fonts embedded in this file are not MIT");

    // Two-column notes build column by column (stream order), not interleaved row by row.
    const priorityOf = (start: string) => crops.find((c) => String(c.meta?.text).startsWith(start))?.priority ?? -1;
    expect(priorityOf("heading takes a while")).toBeLessThan(priorityOf("Pictures are swept"));
    expect(priorityOf("Keep headings short")).toBeGreaterThan(priorityOf("Notes for authors"));

    // Every pdf.js text item (centre of its em box) lies inside a crop of its page.
    const { pdfjs, worker } = await getRuntime(resolveOptions());
    const task = pdfjs.getDocument({ data: bytes.slice(), worker, verbosity: 0 });
    const doc = await task.promise;
    let items = 0;
    let covered = 0;
    for (const sheet of blueprint.layers.filter((l) => l.role === "page")) {
      const n = sheet.meta?.page as number;
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: sheet.box.w / page.getViewport({ scale: 1 }).width });
      const boxes = crops.filter((c) => c.meta?.page === n).map((c) => c.box);
      const { items: list } = await page.getTextContent();
      for (const item of list) {
        if (!("str" in item) || !item.str.trim()) continue;
        const tx = pdfjs.Util.transform(vp.transform, item.transform);
        const size = Math.hypot(tx[2], tx[3]);
        const angle = Math.atan2(tx[1], tx[0]);
        const half = (item.width * vp.scale) / 2;
        const x = sheet.box.x + tx[4] + Math.cos(angle) * half + Math.sin(angle) * size * 0.35;
        const y = sheet.box.y + tx[5] + Math.sin(angle) * half - Math.cos(angle) * size * 0.35;
        items++;
        if (boxes.some((b) => inside(x, y, b))) covered++;
      }
    }
    await task.destroy();
    console.info(`text items covered: ${covered}/${items}`);
    expect(items).toBeGreaterThan(50);
    expect(covered / items).toBeGreaterThan(0.97);
  });

  it("keeps figures as swept crops and rules as paths", async () => {
    const figures = blueprint.layers.filter(isImage).filter((l) => l.meta?.part === "image");
    expect(figures.length).toBeGreaterThanOrEqual(1);
    expect(figures.every((f) => f.reveal === "sweep")).toBe(true);
    const paths = blueprint.layers.filter((l) => l.kind === "path");
    expect(paths.length).toBeGreaterThanOrEqual(5);
    expect(paths.some((p) => p.kind === "path" && p.stroke && p.reveal === "pen")).toBe(true);
    expect(paths.some((p) => p.kind === "path" && p.reveal === "trace")).toBe(true);

    for (const layer of blueprint.layers.filter(isImage)) {
      const { crop, natural } = layer;
      expect(crop && natural).toBeTruthy();
      if (!crop || !natural) continue;
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y + crop.h).toBeLessThanOrEqual(natural.h);
      expect(layer.box.w / crop.w).toBeCloseTo(layer.box.h / crop.h, 5);
    }
    const img = new Image();
    img.src = (figures[0] as ImageLayer).src;
    await img.decode();
    expect(img.naturalWidth).toBe((figures[0] as ImageLayer).natural?.w);
  });

  it("runs pdf.js in a worker", async () => {
    expect((await getRuntime(resolveOptions())).mainThread).toBe(false);
  });

  it("truncates at maxPages and frees its bitmaps on dispose", async () => {
    const loaded = await createPdfAdapter({ maxPages: 1, urlType: "blob" }).load({ bytes }, ctx);
    const bp = loaded.blueprint;
    expect(bp.layers.filter((l) => l.role === "page")).toHaveLength(1);
    expect(bp.truncated).toEqual({ reason: "Showing the first 1 of 2 pages", dropped: 1 });
    const src = (bp.layers.find(isImage) as ImageLayer).src;
    expect((await fetch(src)).ok).toBe(true);
    loaded.dispose?.();
    await expect(fetch(src)).rejects.toThrow();
  });

  it("opens a PDF with the legacy build where Promise.withResolvers is missing (Chrome 116-118)", async () => {
    const P = Promise as unknown as { withResolvers?: unknown };
    const native = P.withResolvers;
    delete P.withResolvers;
    try {
      const loaded = await createPdfAdapter({ maxPages: 1 }).load({ bytes }, ctx);
      expect(textCrops(loaded.blueprint).length).toBeGreaterThan(10);
      loaded.dispose?.();
      // A worker would lack withResolvers as well, so the default runtime parses on the main thread.
      expect(await getRuntime(resolveOptions({ build: "legacy" }))).toMatchObject({
        build: "legacy",
        mainThread: true,
      });
    } finally {
      Object.defineProperty(Promise, "withResolvers", { value: native, writable: true, configurable: true });
    }
  }, 60_000);

  it("falls back to the main thread when the worker URL is unusable", async () => {
    const adapter = createPdfAdapter({ workerSrc: new URL("/missing/pdf.worker.mjs", location.href), maxPages: 1 });
    const loaded = await adapter.load({ bytes }, ctx);
    expect(textCrops(loaded.blueprint).length).toBeGreaterThan(10);
    loaded.dispose?.();
  }, 60_000);
});
