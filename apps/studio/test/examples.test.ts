import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
    // Generators (.mjs) and folder READMEs stay out; Markdown samples ship.
    expect(files.filter((f) => /\.mjs$|(^|\/)readme\.md$/i.test(f))).toEqual([]);
    expect(files).toContain("markdown/welcome.en.md");
    // The copyright and licence of copied samples ship next to them, unlisted.
    expect(files).toContain("doc/SOURCES.md");
    expect(paths).not.toContain("doc/SOURCES.md");
  });

  it("gives every sample of a format its own title", () => {
    // Cards and their "Play <title>" labels go by title; only language variants of one sample may share it.
    const { manifest } = scanExamples(resolve(import.meta.dirname, "../../../examples"));
    const groups = new Map<string, Set<string>>();
    for (const e of manifest.entries) {
      const key = `${e.format}: ${e.title}`;
      groups.set(key, (groups.get(key) ?? new Set()).add(e.group));
    }
    expect([...groups].filter(([, g]) => g.size > 1).map(([key]) => key)).toEqual([]);
  });

  it("ships the licence of every library template a sample generator builds on", () => {
    // python-docx, python-pptx and openpyxl copy parts of their default templates into the output.
    const templates = [
      [/^from (docx|pptx) import/m, "Copyright (c) 2013 Steve Canny"],
      [/^from openpyxl import/m, "Copyright (c) 2010 openpyxl"],
    ] as const;
    const root = resolve(import.meta.dirname, "../../../examples");
    const { files } = scanExamples(root);
    const checked: string[] = [];
    for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      for (const script of readdirSync(join(root, dir.name)).filter((name) => name.endsWith(".py"))) {
        const code = readFileSync(join(root, dir.name, script), "utf8");
        for (const [usesTemplate, copyright] of templates) {
          if (!usesTemplate.test(code)) continue;
          const notice = `${dir.name}/SOURCES.md`;
          expect(files, `${dir.name}/${script} needs ${notice}`).toContain(notice);
          const text = readFileSync(join(root, notice), "utf8");
          expect(text).toContain(copyright);
          expect(text).toContain("Permission is hereby granted");
          checked.push(dir.name);
        }
      }
    }
    expect(checked).toEqual(expect.arrayContaining(["docx", "sheet", "slides"]));
  });

  it("names every font embedded in a sample PDF in the folder's SOURCES.md", () => {
    // Chromium embeds subsets of the machine's fonts (Liberation is GPL v2 with an exception), not MIT material.
    const root = resolve(import.meta.dirname, "../../../examples");
    const { files } = scanExamples(root);
    const pdfs = files.filter((f) => f.endsWith(".pdf"));
    expect(pdfs).toContain("pdf/brochure.pdf");
    for (const pdf of pdfs) {
      const bytes = readFileSync(join(root, pdf), "latin1");
      const fonts = new Set([...bytes.matchAll(/\/FontName\s*\/(?:[A-Z]{6}\+)?([^\s/<>[\]()]+)/g)].map((m) => m[1]));
      const notice = `${dirname(pdf)}/SOURCES.md`;
      expect(files, `${pdf} embeds ${[...fonts].join(", ")}`).toContain(notice);
      const text = readFileSync(join(root, notice), "utf8");
      const missing = [...fonts].filter((font) => !text.includes(`${font}\``));
      expect(missing, notice).toEqual([]);
    }
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
    // One Lottie card, the archive: the gallery goes by name, and .json files outside code/ are not listed.
    expect(["lottie/shuttle-loop.lottie", "lottie/shuttle-loop.json"].map(formatOf)).toEqual(["lottie", undefined]);
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
