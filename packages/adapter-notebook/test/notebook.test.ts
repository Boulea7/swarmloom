import type { CustomLayer, TextLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import example from "../../../examples/notebook/loom-tour.ipynb?raw";
import {
  cleanStyle,
  createNotebookAdapter,
  highlightCode,
  imageSize,
  looksLikeNotebook,
  markdownToHtml,
  NotebookError,
  notebookAdapter,
  notebookPalette,
  parseNotebook,
  promptText,
  RUN_TASK,
  readRunData,
  resolveAttachments,
  sanitizeHtml,
} from "../src/index";

const EXAMPLE = example;
const ctx = { document, width: 960, theme: "light" as const };
const light = notebookPalette("light");

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

const nb = (cells: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5, ...extra });
const codeCell = (outputs: unknown[], count: number | null = 1): Record<string, unknown> => ({
  cell_type: "code",
  execution_count: count,
  metadata: {},
  source: ["x = 1\n", "x"],
  outputs,
});

describe("parseNotebook", () => {
  it("reads the example: cells, counts and every output kind", () => {
    const book = parseNotebook(EXAMPLE);
    expect(book.language).toBe("python");
    expect(book.cells.map((c) => c.kind)).toEqual([
      "markdown",
      "code",
      "code",
      "markdown",
      "code",
      "code",
      "code",
      "code",
      "markdown",
      "code",
    ]);
    const outputs = book.cells.flatMap((c) => (c.kind === "code" ? c.outputs.map((o) => o.kind) : []));
    expect(outputs).toEqual(["stream", "text", "html", "image", "error", "stream", "stream"]);
    const last = book.cells[9];
    expect(last?.kind === "code" && last.count).toBeNull();
    expect(book.dropped).toBe(0);
  });

  it("prefers HTML, then images, then markdown and plain text", () => {
    const out = (data: Record<string, unknown>) => ({ output_type: "display_data", data, metadata: {} });
    const book = parseNotebook(
      nb([
        codeCell([
          out({ "text/html": "<b>x</b>", "image/png": PNG_1X1, "text/plain": "x" }),
          out({ "text/html": "<div id=p></div><script>plot()</script>", "image/png": PNG_1X1 }),
          out({ "text/markdown": "**m**", "text/plain": "m" }),
          out({ "text/plain": ["a\n", "b"] }),
        ]),
      ]),
    );
    const cell = book.cells[0];
    expect(cell?.kind === "code" && cell.outputs.map((o) => o.kind)).toEqual(["html", "image", "markdown", "text"]);
  });

  it("skips and counts what it cannot draw", () => {
    const book = parseNotebook(
      nb([
        codeCell([
          { output_type: "display_data", data: { "application/vnd.jupyter.widget-view+json": {} } },
          { output_type: "display_data", data: { "image/png": "not base64!" } },
          { output_type: "update_display_data", data: {} },
        ]),
        { cell_type: "heading", source: "old" },
        { cell_type: "markdown", source: "kept" },
        { cell_type: "markdown", source: "cut" },
      ]),
      { maxCells: 3 },
    );
    expect(book.cells.map((c) => c.kind)).toEqual(["code", "markdown"]);
    expect(book.dropped).toBe(5);
    expect(book.notes.join(" ")).toMatch(/first 3 of 4 cells/);
  });

  const rejects: [string, string, RegExp][] = [
    ["invalid JSON", "{nope", /not valid JSON/],
    ["an array", "[]", /expected a JSON object/],
    ["no nbformat", '{"cells": []}', /no nbformat field/],
    ["nbformat 3", '{"nbformat": 3, "worksheets": []}', /nbformat 3 is not supported/],
    ["no cells", '{"nbformat": 4, "metadata": {}}', /cells list is missing/],
  ];
  it.each(rejects)("rejects %s", (_name, text, message) => {
    expect(() => parseNotebook(text)).toThrow(NotebookError);
    expect(() => parseNotebook(text)).toThrow(message);
  });

  it("sniffs notebooks", () => {
    expect(looksLikeNotebook(EXAMPLE)).toBe(true);
    expect(looksLikeNotebook('{"name": "pkg", "version": "1.0.0"}')).toBe(false);
    expect(notebookAdapter.sniff?.(new TextEncoder().encode(EXAMPLE.slice(0, 2000)))).toBe(true);
  });
});

describe("markdown and HTML", () => {
  it("renders GFM through adapter-markdown's renderer, with notebook-highlighted fences", () => {
    const html = markdownToHtml(
      "| a | b |\n|:-|-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~ [ok](https://example.org) [bad](javascript:alert(1))\n\n```python\ndef f(): pass\n```",
      { highlight: (code, lang) => highlightCode(code, lang, light) },
    );
    expect(html).toMatch(/^<article class="loom-doc"/);
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toMatch(/<li class="task-item"[^>]*><span class="task-box"[^>]*aria-label="done">/);
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('<a href="https://example.org">ok</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain(`<span style="color:${light.syntax.keyword}">def</span>`);
  });

  it("keeps formulas as their TeX source and prices as text", () => {
    const html = markdownToHtml("Energy $E=mc^2$, costs $5 and $6.\n\n$$\n\\int x\n$$");
    expect(html).toContain('<span class="loom-math" role="math" aria-label="E=mc^2">$E=mc^2$</span>');
    expect(html).toContain("costs $5 and $6.");
    expect(html).toContain("$$\\int x$$");
    expect(html).not.toContain("loom-math-error");
  });

  it("sanitizes HTML and applies the image policy", () => {
    const dirty =
      '<style>body{display:none}</style><p onclick="x()" style="color:red;position:fixed;background:url(https://t.example/p)">hi</p>' +
      `<script>alert(1)</script><a href="javascript:alert(1)">j</a><img src="https://t.example/i.png" alt="remote"><img src="data:image/png;base64,${PNG_1X1}">`;
    const clean = sanitizeHtml(dirty, document);
    expect(clean).toContain('<p style="color:red">hi</p>');
    expect(clean).not.toMatch(/<script|<style|onclick|javascript:|t\.example/);
    expect(clean).toContain('<span class="slnb-noimg">[image: remote]</span>');
    expect(clean).toMatch(/<img src="data:image\/png;base64,[^"]+" width="1" height="1">/);
  });

  it("resolves cell attachments", () => {
    const md = resolveAttachments("![dot](attachment:dot.png) ![gone](attachment:none.png)", {
      "dot.png": { mime: "image/png", data: PNG_1X1 },
    });
    expect(md).toContain("](data:image/png;base64,");
    expect(md).toContain("attachment:none.png");
  });

  const styles: [string, string][] = [
    ["color: red; font-weight: bold", "color:red;font-weight:bold"],
    ["position:absolute;top:0;z-index:9", ""],
    ["background-image:url(x.png);margin:0", "margin:0"],
    ["width: expression(alert(1))", ""],
  ];
  it.each(styles)("cleans inline style %s", (input, expected) => {
    expect(cleanStyle(input)).toBe(expected);
  });
});

describe("code and images", () => {
  it("highlights known kernels with inline colours and escapes the rest", () => {
    expect(highlightCode("import math  # c", "ipython3", light)).toContain(
      `<span style="color:${light.syntax.comment};font-style:italic"># c</span>`,
    );
    expect(highlightCode("a < b", "brainfork", light)).toBe("a &lt; b");
  });

  it("reads PNG, JPEG and GIF sizes from headers", () => {
    const jpeg = b64([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 3, 0, 0,
    ]);
    const gif = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00, 0, 0]);
    expect(imageSize("image/png", PNG_1X1)).toEqual({ w: 1, h: 1 });
    expect(imageSize("image/jpeg", jpeg)).toEqual({ w: 64, h: 48 });
    expect(imageSize("image/gif", gif)).toEqual({ w: 32, h: 16 });
    expect(imageSize("image/png", gif)).toBeNull();
  });
});

describe("notebookAdapter", () => {
  it("chains every code cell frame -> code -> run -> outputs", async () => {
    const { blueprint, plugins } = await notebookAdapter.load({ text: EXAMPLE, name: "loom-tour.ipynb" }, ctx);
    expect(blueprint.source).toEqual({ type: "notebook", name: "loom-tour.ipynb", title: "Weaving a notebook" });
    expect(blueprint.plugins).toEqual(["notebook"]);
    expect(plugins?.[0]?.tasks?.[RUN_TASK]).toBeTypeOf("function");
    const byId = new Map(blueprint.layers.map((l) => [l.id, l]));
    expect(byId.get("nb-1-code")?.parent).toBe("nb-1-frame");
    expect(byId.get("nb-1-run")?.parent).toBe("nb-1-code");
    expect(byId.get("nb-1-out0")?.parent).toBe("nb-1-run");
    expect((byId.get("nb-2-out0-prompt") as TextLayer).text).toBe("Out [2]:");
    expect(byId.get("nb-5-out0")?.kind).toBe("image");
    expect(byId.get("nb-0-md")?.role).toBe("paragraph");
    // The cell that never ran has a static prompt and no run indicator.
    expect(byId.has("nb-9-run")).toBe(false);
    expect((byId.get("nb-9-prompt") as TextLayer).text).toBe("In [ ]:");
    // Cells stack without overlapping.
    const frames = blueprint.layers.filter((l) => l.id.endsWith("-frame") || l.id.endsWith("-md"));
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1]?.box;
      const b = frames[k]?.box;
      expect((b?.y ?? 0) >= (a?.y ?? 0) + (a?.h ?? 0), frames[k]?.id).toBe(true);
    }
    expect(blueprint.truncated).toBeUndefined();
  });

  it("validates run data", () => {
    const layer = { id: "r", kind: "custom", task: RUN_TASK, box: { x: 0, y: 0, w: 1, h: 1 } } as CustomLayer;
    expect(readRunData({ ...layer, data: { count: -1, ms: 100 } })).toBeNull();
    const data = readRunData({ ...layer, data: { count: 7, ms: 99_999, color: "red" } });
    expect(data).toMatchObject({ count: 7, ms: 4000, color: "#5B5BF7" });
    expect(promptText(data as never, "running")).toBe("In [*]:");
  });

  it("drops whole cells at the layer limit and rejects bad input", async () => {
    const { blueprint } = await notebookAdapter.load({ text: EXAMPLE }, { ...ctx, theme: "dark", maxLayers: 8 });
    expect(blueprint.background).toBe("#0B0B12");
    expect(blueprint.layers.length).toBeLessThanOrEqual(8);
    expect(blueprint.truncated?.reason).toMatch(/layer limit/);
    await expect(notebookAdapter.load({ text: '{"cells": []}' }, ctx)).rejects.toThrow(NotebookError);
    await expect(createNotebookAdapter({ maxBytes: 10 }).load({ text: EXAMPLE }, ctx)).rejects.toThrow(/too large/);
    await expect(notebookAdapter.load({}, ctx)).rejects.toThrow(/text, bytes or a URL/);
  });
});
