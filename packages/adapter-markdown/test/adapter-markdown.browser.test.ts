import type { Blueprint } from "@swarmloom/core";
import katex from "katex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import loomSvg from "../../../examples/markdown/assets/loom.svg?raw";
import en from "../../../examples/markdown/welcome.en.md?raw";
import zh from "../../../examples/markdown/welcome.zh.md?raw";
import { createMarkdownAdapter, createMathEngine, MEASURE } from "../src/index";
import { KATEX_FONTS } from "../src/math/katex-assets";
import { probeSnapshot } from "./probe";

// Vitest turns CSS imports into empty strings, so the KaTeX style sheet is read from disk (the
// path is relative to the workspace root); package builds inline it (see tsup.config.ts).
let katexCss = "";
let svgUrl = "";
beforeAll(async () => {
  katexCss = await commands.readFile("packages/adapter-markdown/node_modules/katex/dist/katex.min.css");
  svgUrl = URL.createObjectURL(new Blob([loomSvg], { type: "image/svg+xml" }));
});
afterAll(() => URL.revokeObjectURL(svgUrl));

function adapter() {
  return createMarkdownAdapter({
    snapshot: probeSnapshot,
    loadMath: async () => createMathEngine(katex, katexCss, KATEX_FONTS),
    resolveAsset: (path) => (path === "assets/loom.svg" ? svgUrl : undefined),
  });
}

function count(bp: Blueprint, role: string): number {
  return bp.layers.filter((l) => l.role === role).length;
}

/** Requests the page made since `since` that left the test server (data: and blob: never appear). */
function externalRequests(since: number): string[] {
  return performance
    .getEntriesByType("resource")
    .filter((e) => e.startTime >= since && new URL(e.name).origin !== location.origin)
    .map((e) => e.name);
}

describe("markdown examples in Chromium", () => {
  it("welcome.en.md becomes a themed page with real blocks, math, code and the figure", async () => {
    const t0 = performance.now();
    const { blueprint, warnings } = await adapter().load(
      { name: "welcome.en.md", text: en },
      { document, width: 1400, theme: "light" },
    );
    expect(warnings).toEqual([]);
    expect(blueprint.source).toMatchObject({ type: "markdown", title: "Welcome to SwarmLoom" });
    expect(blueprint.size.w).toBe(920);
    expect(blueprint.size.h).toBeGreaterThan(1500);
    expect(blueprint.scheme).toBe("light");

    const body = blueprint.layers.find((l) => l.role === "section");
    expect(body?.box.w).toBe(MEASURE);
    expect(body?.box.x).toBe((920 - MEASURE) / 2);
    for (const layer of blueprint.layers) expect(layer.box.x + layer.box.w).toBeLessThanOrEqual(920.5);

    expect(count(blueprint, "heading")).toBeGreaterThanOrEqual(6);
    expect(count(blueprint, "paragraph")).toBeGreaterThanOrEqual(8);
    expect(count(blueprint, "list-item")).toBe(13);
    expect(count(blueprint, "code")).toBe(2);
    expect(count(blueprint, "table")).toBe(1);
    expect(count(blueprint, "row")).toBe(5);
    expect(count(blueprint, "quote")).toBe(2);
    expect(count(blueprint, "math")).toBe(5);

    const figure = blueprint.layers.find((l) => l.role === "figure");
    expect(figure).toMatchObject({ src: svgUrl, natural: { w: 640, h: 280 } });
    const formula = blueprint.layers.find((l) => l.role === "math");
    expect(formula && "style" in formula ? formula.style?.["font-family"] : "").toContain("KaTeX_Main");
    expect(document.fonts.check('16px "KaTeX_Main"')).toBe(true);
    expect(blueprint.css).toContain(".loom-doc");
    expect(externalRequests(t0)).toEqual([]);
  });

  it("welcome.zh.md lays out CJK text in the dark theme within the measure", async () => {
    const t0 = performance.now();
    const { blueprint, warnings } = await adapter().load(
      { name: "welcome.zh.md", text: zh },
      { document, width: 820, theme: "dark", locale: "zh-CN" },
    );
    expect(warnings).toEqual([]);
    expect(blueprint.source.title).toBe("欢迎使用群织 SwarmLoom");
    expect(blueprint.scheme).toBe("dark");
    expect(blueprint.size.w).toBe(820);
    const body = blueprint.layers.find((l) => l.role === "section");
    expect(body?.box.w).toBe(MEASURE);

    const headings = blueprint.layers.filter((l) => l.role === "heading").map((l) => ("text" in l ? l.text : ""));
    expect(headings.slice(0, 3)).toEqual(["欢迎使用群织", "能织什么", "一次重建的过程"]);
    expect(count(blueprint, "list-item")).toBe(13);
    expect(count(blueprint, "row")).toBe(5);
    expect(count(blueprint, "math")).toBe(5);
    // The callout title follows the locale.
    const quote = blueprint.layers.find((l) => l.role === "quote");
    expect(quote && "text" in quote ? quote.text : "").toMatch(/^说明|^注意|^提示/);
    expect(externalRequests(t0)).toEqual([]);
  });

  it("narrow pages keep the side padding and stay inside the minimum width", async () => {
    const { blueprint } = await adapter().load(
      { name: "welcome.en.md", text: en },
      { document, width: 200, theme: "light" },
    );
    expect(blueprint.size.w).toBe(360);
    const body = blueprint.layers.find((l) => l.role === "section");
    expect(body?.box.w).toBe(360 - 48);
    for (const layer of blueprint.layers) expect(layer.box.x + layer.box.w).toBeLessThanOrEqual(360.5);
  });
});
