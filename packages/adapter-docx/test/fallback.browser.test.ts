import { describe, expect, it, vi } from "vitest";
import { DocxError, loadDocx } from "../src/index";
import { fakeSnapshotHtml } from "./fake-snapshot";

// docx-preview fails on every document in this file, so the built-in renderer has to take over.
vi.mock("docx-preview", () => ({
  parseAsync: async () => {
    throw new Error("unsupported construct");
  },
  renderDocument: async () => [],
  renderAsync: async () => undefined,
}));

async function sampleBytes(): Promise<Uint8Array> {
  const res = await fetch(new URL("../../../examples/docx/report.docx", import.meta.url));
  return new Uint8Array(await res.arrayBuffer());
}

const ctx = { document, width: 900, theme: "light" as const };

describe("renderer fallback", () => {
  it("falls back to the plain renderer and says so", async () => {
    const loaded = await loadDocx({ name: "report.docx", bytes: await sampleBytes() }, ctx, {
      snapshotHtml: fakeSnapshotHtml(),
    });
    expect(loaded.renderer).toBe("plain");
    expect(loaded.pages).toBe(3);
    expect(loaded.notes[0]).toMatch(/simplified view is shown/);
    expect(loaded.notes[0]).toContain("unsupported construct");
    expect(loaded.notes.some((n) => /leaves out .*picture/.test(n))).toBe(true);
    expect(loaded.blueprint.layers.filter((l) => l.role === "page")).toHaveLength(3);
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  }, 60_000);

  it("fails with render-failed when the fallback is disabled", async () => {
    const error = await loadDocx({ bytes: await sampleBytes() }, ctx, {
      renderer: "preview",
      snapshotHtml: fakeSnapshotHtml(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocxError);
    expect(error).toMatchObject({ code: "render-failed" });
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });

  it("stops when the load is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadDocx(
        { bytes: await sampleBytes() },
        { ...ctx, signal: controller.signal },
        { snapshotHtml: fakeSnapshotHtml() },
      ),
    ).rejects.toThrow();
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });
});
