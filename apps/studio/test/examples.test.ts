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
    // Generators (.mjs) and folder notes (README.md, SOURCES.md) stay out; Markdown samples ship.
    expect(files.filter((f) => /\.mjs$|(^|\/)(readme|sources)\.md$/i.test(f))).toEqual([]);
    expect(files).toContain("markdown/welcome.en.md");
  });

  it("lists the second-wave formats and draws snippets from text only", () => {
    const { manifest } = scanExamples(resolve(import.meta.dirname, "../../../examples"));
    const byPath = new Map(manifest.entries.map((e) => [e.path, e]));
    const formatOf = (path: string) => byPath.get(path)?.format;
    expect(
      ["epub/loom-notes.epub", "odf/report.odt", "odf/deck.odp", "odf/budget.ods", "rtf/loom-letter.rtf"].map(formatOf),
    ).toEqual(["epub", "odf", "odf", "sheet", "rtf"]);
    expect(
      ["ofd/loom-receipt.ofd", "notebook/loom-tour.ipynb", "terminal/session.cast", "diff/core-index.patch"].map(
        formatOf,
      ),
    ).toEqual(["ofd", "notebook", "terminal", "diff"]);
    expect(["mindmap/loom.xmind", "mindmap/release-plan.mm"].map(formatOf)).toEqual(["mindmap", "mindmap"]);
    // "sheet" covers CSV text and binary workbooks: only the text gets a snippet.
    expect(byPath.get("sheet/cities.csv")?.snippet).toBeTruthy();
    expect(byPath.get("sheet/sales.xlsx")?.snippet).toBeUndefined();
    expect(byPath.get("markdown/welcome.en.md")?.snippet).not.toMatch(/^---/);
    expect(byPath.get("diff/core-index.patch")?.snippet).toMatch(/^diff --git /);
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
