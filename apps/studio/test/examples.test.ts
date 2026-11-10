import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanExamples } from "../build/examples";
import { isSupportingAsset, pageDirsOf } from "../src/examples/manifest";

describe("examples manifest", () => {
  it("lists every sample of the repository's examples folder and ships no generators", () => {
    const { manifest, files } = scanExamples(resolve(import.meta.dirname, "../../../examples"));
    const paths = manifest.entries.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["image/scene.webp", "pdf/brochure.pdf", "svg/chart.svg", "svg/emblem.svg"]),
    );
    expect(new Set(manifest.entries.map((e) => e.id)).size).toBe(paths.length);
    expect(files.filter((f) => /\.(mjs|md)$/.test(f))).toEqual([]);
  });

  it.each([
    ["image/scene.webp", false],
    ["markdown/images/figure.png", true],
    ["html/site/index.html", false],
    ["html/site/style.css", true],
  ])("treats %s as a supporting asset: %s", (path, expected) => {
    const pageDirs = pageDirsOf(["html/site/index.html"]);
    expect(isSupportingAsset(path, pageDirs)).toBe(expected);
  });
});
