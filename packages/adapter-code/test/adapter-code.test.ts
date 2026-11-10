import type { TextLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import {
  codeAdapter,
  detectLanguage,
  highlight,
  indentGuides,
  LOOM_DAY,
  layoutEditor,
  lineToHtml,
  parseHighlightHtml,
} from "../src/index";
import { classToScope } from "../src/syntax/highlight";

const ctx = { document, width: 960, theme: "light" as const };

describe("detectLanguage", () => {
  const cases: [string, Parameters<typeof detectLanguage>[0], string][] = [
    ["extension", { name: "src/app.tsx" }, "typescript"],
    ["extension case and url query", { name: "https://x.dev/raw/Main.PY?token=1" }, "python"],
    ["exact file name", { name: "Dockerfile" }, "dockerfile"],
    ["file name with suffix", { name: "Dockerfile.dev" }, "dockerfile"],
    ["specific mime", { mime: "text/x-python; charset=utf-8", text: "x = 1" }, "python"],
    ["shebang beats a .txt name", { name: "run.txt", text: "#!/usr/bin/env node\nconsole.log(1)" }, "javascript"],
    ["json content", { text: '{ "a": [1, 2] }' }, "json"],
    ["typescript content", { text: "interface Point { x: number }\nconst p: Point = { x: 1 };" }, "typescript"],
    ["python content", { text: "from os import path\n\ndef main():\n    pass\n" }, "python"],
    ["go content", { text: "package main\n\nfunc main() {\n}\n" }, "go"],
    ["prose stays plain text", { text: "Hello there, this is a note." }, "plaintext"],
  ];
  it.each(cases)("%s", (_label, input, expected) => {
    expect(detectLanguage(input).id).toBe(expected);
  });
});

describe("highlighting", () => {
  it("maps highlight.js classes to scope keys", () => {
    expect(classToScope("hljs-title function_")).toBe("title.function");
    expect(classToScope("hljs-title class_ inherited__")).toBe("title.class.inherited");
    expect(classToScope("language-css")).toBe("");
  });

  it("splits spans that cross line breaks and decodes entities", () => {
    const lines = parseHighlightHtml('<span class="hljs-comment">/* a\nb */</span> x &lt; 1');
    expect(lines).toEqual([
      [{ text: "/* a", scope: "comment" }],
      [
        { text: "b */", scope: "comment" },
        { text: " x < 1", scope: "" },
      ],
    ]);
  });

  it("highlights TypeScript with a lazily loaded grammar and escapes HTML", async () => {
    const out = await highlight('const tag = "<b>"; // done', "typescript");
    expect(out.warning).toBeUndefined();
    const scopes = out.lines[0]?.map((t) => t.scope);
    expect(scopes).toContain("keyword");
    expect(scopes).toContain("string");
    const html = lineToHtml(out.lines[0] ?? [], LOOM_DAY);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain(`color:${LOOM_DAY.tokens.keyword?.color}`);
  });

  it("falls back to plain text for oversize input", async () => {
    const out = await highlight("let a = 1;\n".repeat(20), "javascript", { maxChars: 10 });
    expect(out.warning).toMatch(/not highlighted/);
    expect(out.lines).toHaveLength(20);
  });
});

describe("editor layout", () => {
  const lines = (n: number, text = "value = compute(x)") => Array.from({ length: n }, () => [{ text, scope: "" }]);

  it("emits a panel, line numbers and one typed layer per non-blank line", () => {
    const src = {
      language: { id: "python", label: "Python", short: "PY", extensions: [], aliases: [] },
      lines: [...lines(3), [], [{ text: "    return x", scope: "" }]],
    };
    const { blueprint, metrics } = layoutEditor(src, { width: 960, theme: LOOM_DAY, fileName: "a.py" });
    const code = blueprint.layers.filter((l): l is TextLayer => l.role === "code");
    expect(code).toHaveLength(4);
    expect(code.every((l) => l.reveal === "type")).toBe(true);
    expect(blueprint.layers.filter((l) => l.role === "line-number")).toHaveLength(5);
    const indented = code[3] as TextLayer;
    expect(indented.text).toBe("return x");
    expect(indented.box.x).toBeCloseTo(metrics.code.x + 4 * metrics.charWidth, 1);
    expect(metrics.fontSize).toBe(15);
    expect(blueprint.size.h).toBeGreaterThan(metrics.code.y + metrics.code.h);
    expect(blueprint.truncated).toBeUndefined();
  });

  it("shrinks the font for long lines and clips what still overflows", () => {
    const src = {
      language: { id: "plaintext", label: "Plain text", short: "TXT", extensions: [], aliases: [] },
      lines: [[{ text: "x".repeat(400), scope: "" }]],
    };
    const { blueprint, metrics } = layoutEditor(src, { width: 800, theme: LOOM_DAY, fileName: "long.txt" });
    expect(metrics.fontSize).toBe(10);
    const line = blueprint.layers.find((l) => l.id === "line-1");
    expect(line?.clip).toEqual(metrics.code);
  });

  it("respects maxLayers and reports the dropped lines", () => {
    const src = {
      language: { id: "plaintext", label: "Plain text", short: "TXT", extensions: [], aliases: [] },
      lines: lines(100),
    };
    const { blueprint } = layoutEditor(src, { width: 960, theme: LOOM_DAY, fileName: "a.txt", maxLayers: 50 });
    expect(blueprint.layers.length).toBeLessThanOrEqual(50);
    expect(blueprint.truncated?.dropped).toBe(80);
  });

  it("computes indent guides through blank lines", () => {
    // The level-2 run (line 4 only) is shorter than the two-line minimum.
    expect(indentGuides([0, 2, null, 2, 4, 0])).toEqual([{ col: 0, from: 1, to: 4 }]);
  });
});

describe("codeAdapter.load", () => {
  it("builds a blueprint from text input", async () => {
    const { blueprint } = await codeAdapter.load(
      { name: "hello.ts", text: "export const answer: number = 42;\n" },
      ctx,
    );
    expect(blueprint.source).toMatchObject({ type: "code", name: "hello.ts" });
    expect(blueprint.layers.find((l) => l.id === "line-1")).toMatchObject({
      kind: "text",
      text: "export const answer: number = 42;",
    });
  });

  it.each([
    ["no input", {}, ctx, /needs text, bytes or url/],
    ["bad width", { text: "x" }, { ...ctx, width: 0 }, /width must be positive/],
    ["oversize bytes", { bytes: new Uint8Array(3 * 1024 * 1024) }, ctx, /over the 2.0 MB limit/],
    ["bad url scheme", { url: "javascript:alert(1)" }, ctx, /unsupported URL scheme/],
  ])("rejects %s", async (_label, input, context, message) => {
    await expect(codeAdapter.load(input, context)).rejects.toThrow(message);
  });
});
