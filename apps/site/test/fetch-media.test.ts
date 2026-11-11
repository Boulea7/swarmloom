import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetTarget, CLIP_FORMATS, fetchMedia, selectAssets } from "../scripts/fetch-media.mjs";
import { FORMAT_IDS } from "../src/content/formats";

const MB = 1024 * 1024;

describe("release asset mapping", () => {
  it("keeps the clip list in step with the format strip", () => {
    expect(CLIP_FORMATS).toEqual([...FORMAT_IDS]);
  });

  it("maps flat release names to public/media paths", () => {
    expect(assetTarget("promo-zh.mp4")?.path).toBe("promo-zh.mp4");
    expect(assetTarget("promo-en.vtt")?.path).toBe("promo-en.vtt");
    expect(assetTarget("promo-poster.avif")?.path).toBe("promo-poster.avif");
    expect(assetTarget("clips-three.webm")?.path).toBe("clips/model.webm");
    expect(assetTarget("clips-doc.mp4")?.path).toBe("clips/word.mp4");
    expect(assetTarget("clips-docx.mp4")?.path).toBe("clips/word.mp4");
    expect(assetTarget("clips-sheet.avif")?.path).toBe("clips/sheets.avif");
    expect(assetTarget("clips-pdf.avif")?.path).toBe("clips/pdf.avif");
  });

  it.each([
    "clips-unknown.mp4",
    "clip-web.mp4",
    "clips-web.gif",
    "promo-fr.mp4",
    "../promo-zh.mp4",
    "x".repeat(80),
    7,
    null,
  ])("ignores %s", (name) => {
    expect(assetTarget(name)).toBeNull();
  });

  it("drops assets with bad URLs or sizes outside the cap", () => {
    const ok = { name: "clips-web.mp4", size: 2 * MB, browser_download_url: "https://github.com/a/clips-web.mp4" };
    const release = {
      assets: [
        ok,
        { ...ok, name: "clips-svg.mp4", browser_download_url: "http://insecure/clips-svg.mp4" },
        { ...ok, name: "clips-pdf.mp4", size: 21 * MB },
        { ...ok, name: "clips-code.mp4", size: 0 },
        null,
      ],
    };
    expect(selectAssets(release)).toEqual([{ ...pick(ok), path: "clips/web.mp4" }]);
    expect(selectAssets({ assets: "nope" })).toEqual([]);
    expect(selectAssets(undefined)).toEqual([]);
  });

  it("prefers DOCX for the shared Word slot regardless of release order", () => {
    const doc = { name: "clips-doc.mp4", size: MB, browser_download_url: "https://github.com/a/clips-doc.mp4" };
    const docx = { name: "clips-docx.mp4", size: MB, browser_download_url: "https://github.com/a/clips-docx.mp4" };
    for (const assets of [
      [doc, docx],
      [docx, doc],
    ]) {
      expect(selectAssets({ assets })).toEqual([{ ...pick(docx), path: "clips/word.mp4" }]);
    }
  });
});

function pick(asset: { name: string; size: number; browser_download_url: string }) {
  return { name: asset.name, size: asset.size, url: asset.browser_download_url };
}

describe("fetchMedia", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("treats a missing release or a network failure as no media", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "sl-media-"));
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("Not Found", { status: 404 })),
      );
      await expect(fetchMedia(dir)).resolves.toBe(0);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("fetch failed");
        }),
      );
      await expect(fetchMedia(dir)).resolves.toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws in required mode when the lookup or a download fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "sl-media-"));
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("Unavailable", { status: 503 })),
      );
      await expect(fetchMedia(dir)).resolves.toBe(0);
      await expect(fetchMedia(dir, { required: true })).rejects.toThrow(/HTTP 503/);
      const asset = { name: "clips-web.mp4", size: 4, browser_download_url: "https://github.com/a/clips-web.mp4" };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("api.github.com")
            ? Response.json({ assets: [asset] })
            : new Response("Bad Gateway", { status: 502 }),
        ),
      );
      await expect(fetchMedia(dir, { required: true })).rejects.toThrow(/clips-web\.mp4/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
