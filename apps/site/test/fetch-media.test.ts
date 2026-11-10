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
    expect(assetTarget("clip-model.webm")?.path).toBe("clips/model.webm");
    expect(assetTarget("clip-pdf.avif")?.path).toBe("clips/pdf.avif");
  });

  it.each(["clip-unknown.mp4", "clip-web.gif", "promo-fr.mp4", "../promo-zh.mp4", "x".repeat(80), 7, null])(
    "ignores %s",
    (name) => {
      expect(assetTarget(name)).toBeNull();
    },
  );

  it("drops assets with bad URLs or sizes outside the cap", () => {
    const ok = { name: "clip-web.mp4", size: 2 * MB, browser_download_url: "https://github.com/a/clip-web.mp4" };
    const release = {
      assets: [
        ok,
        { ...ok, name: "clip-svg.mp4", browser_download_url: "http://insecure/clip-svg.mp4" },
        { ...ok, name: "clip-pdf.mp4", size: 21 * MB },
        { ...ok, name: "clip-code.mp4", size: 0 },
        null,
      ],
    };
    expect(selectAssets(release)).toEqual([{ ...pick(ok), path: "clips/web.mp4" }]);
    expect(selectAssets({ assets: "nope" })).toEqual([]);
    expect(selectAssets(undefined)).toEqual([]);
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
});
