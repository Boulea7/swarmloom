// @vitest-environment jsdom
/// <reference types="node" />
// DOMPurify needs a conformant DOM: happy-dom passes scripts through, so this suite runs in jsdom.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { SnapshotDom, SnapshotHtmlOptions } from "@swarmloom/adapter-code";
import type { Blueprint } from "@swarmloom/core";
import katex from "katex";
import { describe, expect, it } from "vitest";
import {
  assetPath,
  createMarkdownAdapter,
  createMathEngine,
  type MarkdownLoadContext,
  markdownToHtml,
  safeHref,
  safeImageSrc,
  slugify,
  splitFrontMatter,
} from "../src/index";
import { KATEX_FONTS } from "../src/math/katex-assets";

// Vitest turns every *.css import (also ?raw) into an empty string, so the test reads KaTeX's
// style sheet from disk; package builds inline it through tsup.config.ts.
const katexCss = readFileSync(createRequire(import.meta.url).resolve("katex/dist/katex.min.css"), "utf8");
const loadMath = async () => createMathEngine(katex, katexCss, KATEX_FONTS);

/** Parses rendered HTML so assertions can query structure instead of matching strings. */
async function render(md: string, opts: Parameters<typeof markdownToHtml>[1] = {}) {
  const out = await markdownToHtml(md, { loadMath, ...opts });
  const tpl = document.createElement("template");
  tpl.innerHTML = out.html;
  return { ...out, dom: tpl.content };
}

describe("markdownToHtml: GFM", () => {
  it("renders headings with unique anchors and the title", async () => {
    const { dom, title, headings } = await render("# Hello *loom*\n\n## Usage\n\n## Usage\n\n### 快速开始");
    expect(title).toBe("Hello loom");
    expect(headings.map((h) => h.id)).toEqual(["hello-loom", "usage", "usage-1", "快速开始"]);
    expect(dom.querySelector("h1 em")?.textContent).toBe("loom");
    expect(dom.querySelector("#usage-1")?.tagName).toBe("H2");
  });

  it("renders tables with alignment, task lists, strikethrough and autolinks", async () => {
    const md = [
      "| Name | Score |",
      "| :--- | ----: |",
      "| a    | 1     |",
      "",
      "- [x] done ~~old~~",
      "- [ ] todo www.example.com",
    ].join("\n");
    const { dom } = await render(md);
    expect(dom.querySelectorAll("thead th")).toHaveLength(2);
    expect((dom.querySelector("tbody td:last-child") as HTMLElement).style.textAlign).toBe("right");
    const tasks = dom.querySelectorAll("li.task-item");
    expect(Array.from(tasks, (t) => t.getAttribute("data-checked"))).toEqual(["true", "false"]);
    expect(dom.querySelector(".task-box[data-checked=true] svg")).not.toBeNull();
    expect(dom.querySelector("del")?.textContent).toBe("old");
    expect(dom.querySelector("a")?.getAttribute("href")).toBe("http://www.example.com");
    expect(dom.querySelector("input")).toBeNull();
  });

  it("numbers footnotes by first reference and links back", async () => {
    const { dom } = await render("B[^b] and A[^a] and B again[^b].\n\n[^a]: Note A.\n[^b]: Note B.");
    expect(Array.from(dom.querySelectorAll("sup.fn-ref a"), (a) => a.textContent)).toEqual(["1", "2", "1"]);
    const notes = dom.querySelectorAll(".footnotes li");
    expect(notes[0]?.id).toBe("fn-b");
    expect(notes[0]?.textContent).toContain("Note B.");
    expect(notes[0]?.querySelector("a.fn-back")?.getAttribute("href")).toBe("#fnref-b");
  });

  it("keeps ordered list start numbers and renders markers as elements", async () => {
    const { dom } = await render("3. three\n4. four\n\n- bullet");
    expect(Array.from(dom.querySelectorAll("ol .loom-num"), (n) => n.textContent)).toEqual(["3.", "4."]);
    expect(dom.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(dom.querySelector("ul .loom-bullet")).not.toBeNull();
  });

  it("highlights fenced code with the shared highlighter", async () => {
    const { dom } = await render("```ts\nconst x: number = 1;\n```");
    const block = dom.querySelector(".loom-code");
    expect(block?.getAttribute("data-lang")).toBe("typescript");
    expect(block?.querySelector(".loom-code-head")?.textContent).toBe("TypeScript");
    expect(block?.querySelectorAll("pre code span[style*=color]").length).toBeGreaterThan(1);
    expect(block?.querySelector("pre")?.textContent).toBe("const x: number = 1;");
  });

  it("renders math with KaTeX only when formulas exist", async () => {
    const plain = await render("No math, just $5 and $6.");
    expect(plain.css).not.toContain("KaTeX");
    const { dom, css, fonts } = await render("Euler: $e^{i\\pi} + 1 = 0$\n\n$$\n\\frac{a}{b}\n$$");
    expect(dom.querySelector(".loom-math .katex")).not.toBeNull();
    expect(dom.querySelector(".loom-math-block .katex-display")).not.toBeNull();
    expect(dom.querySelector(".katex-mathml")).toBeNull();
    // snapshot-dom copies KaTeX's markup as-is; its computed styles cannot rebuild the layout.
    expect(dom.querySelectorAll(".loom-math > .katex[data-swarmloom-verbatim]")).toHaveLength(1);
    expect(dom.querySelectorAll(".loom-math-block > .katex-display[data-swarmloom-verbatim]")).toHaveLength(1);
    expect(css).toMatch(/@font-face\{font-family:KaTeX_Main;[^}]*data:font\/woff2;base64,/);
    expect(fonts.some((f) => f.family === "KaTeX_Math")).toBe(true);
  });

  it("shows invalid TeX as source and records a warning", async () => {
    const { dom, warnings } = await render("$$\n\\frac{a}{\n$$");
    expect(dom.querySelector(".loom-math-error")?.textContent).toContain("\\frac{a}{");
    expect(warnings.some((w) => w.startsWith("math:"))).toBe(true);
  });

  it("shows mermaid as a code block without a renderer and as SVG with one", async () => {
    const md = "```mermaid\ngraph TD; A-->B\n```";
    const asCode = await render(md);
    expect(asCode.dom.querySelector(".loom-code pre")?.textContent).toBe("graph TD; A-->B");
    const asSvg = await render(md, {
      renderDiagram: async () =>
        '<svg viewBox="0 0 10 10"><rect width="10" height="10" onclick="x()"/><script>x()</script></svg>',
    });
    const svg = asSvg.dom.querySelector("figure.loom-diagram svg");
    expect(svg?.querySelector("rect")?.hasAttribute("onclick")).toBe(false);
    expect(svg?.querySelector("script")).toBeNull();
  });

  it("keeps common README HTML: centred paragraphs and badges with relative paths resolved", async () => {
    const md = '<p align="center"><img src="docs/logo.svg" width="96" srcset="docs/logo@2x.png 2x"></p>';
    const { dom } = await render(md, { baseUrl: "https://h.dev/repo/" });
    const img = dom.querySelector('p[align="center"] img');
    expect(img?.getAttribute("src")).toBe("https://h.dev/repo/docs/logo.svg");
    expect(img?.getAttribute("width")).toBe("96");
    expect(img?.hasAttribute("srcset")).toBe(false);
  });

  it("turns GitHub alerts into callouts", async () => {
    const { dom } = await render("> [!TIP]\n> Use the CLI.", { locale: "zh-CN" });
    expect(dom.querySelector("blockquote.loom-callout-tip .loom-callout-title")?.textContent).toBe("提示");
    expect(dom.querySelector("blockquote p:last-child")?.textContent).toBe("Use the CLI.");
  });
});

describe("markdownToHtml: safety", () => {
  it("drops scripts, event handlers and script URLs from raw HTML and links", async () => {
    const md = [
      '<script>alert(1)</script><img src="a.png" onerror="alert(2)"><div onclick="alert(3)">ok</div>',
      "",
      '[click](javascript:alert(4)) ![x](javascript:alert(5)) <a href="javascript:alert(6)">raw</a>',
      "",
      '<iframe src="https://example.com"></iframe><style>body{display:none}</style>',
    ].join("\n");
    const { html, dom, warnings } = await render(md);
    expect(html).not.toMatch(/<script|onerror|onclick|javascript:|<iframe|<style/i);
    expect(dom.querySelector("div")?.textContent).toContain("ok");
    expect(warnings.filter((w) => /unsafe URL/.test(w))).toHaveLength(2);
  });

  it("loads https images by default, http only from the document's server, none when remote images are off", async () => {
    const md = '![a](https://x.dev/a.png) ![b](http://x.dev/b.png) <img src="https://x.dev/c.png" alt="c">';
    const on = await render(md);
    expect(Array.from(on.dom.querySelectorAll("img"), (i) => i.getAttribute("src"))).toEqual([
      "https://x.dev/a.png",
      "https://x.dev/c.png",
    ]);
    const off = await render(md, { remoteImages: false });
    expect(off.dom.querySelectorAll("img")).toHaveLength(0);
    expect(off.dom.querySelectorAll(".loom-blocked")).toHaveLength(3);
    expect(off.warnings.filter((w) => w.includes("remote images are off"))).toHaveLength(2);
    // The CLI serves the input folder over http on loopback: relative images stay on that origin.
    const local = await render(md.replace("https://x.dev/a.png", "./img/a.png"), {
      baseUrl: "http://127.0.0.1:4100/input/t/doc.md",
    });
    expect(Array.from(local.dom.querySelectorAll("img"), (i) => i.getAttribute("src"))).toEqual([
      "http://127.0.0.1:4100/input/t/img/a.png",
      "https://x.dev/c.png",
    ]);
  });

  it("applies the image policy to every resource in raw HTML and takes plain http only from loopback", async () => {
    const md = [
      '<div style="background:url(https://t.dev/style.png)">s</div>',
      '<video poster="https://t.dev/poster.png" src="https://t.dev/v.mp4"></video>',
      '<svg width="9" height="9"><image href="https://t.dev/svg.png" width="9" height="9"/></svg>',
      '<table background="https://t.dev/table.png"><tr><td>a</td></tr></table>',
      '<img src="/tracker.png">',
    ].join("\n");
    const off = await render(md, { remoteImages: false, baseUrl: "http://t.dev/doc.md" });
    expect(off.html).not.toContain("t.dev");
    // Remote images on: images stay, media files never load.
    const on = await render(md, { baseUrl: "https://t.dev/doc.md" });
    expect(on.dom.querySelector("video")?.getAttribute("poster")).toBe("https://t.dev/poster.png");
    expect(on.html).not.toContain("v.mp4");
  });

  it("cleans URL edges in linear time when spaces run inside the URL", () => {
    // An end-anchored regex took seconds here; a ~1.4 KB share link could hang the tab for an hour.
    const url = `a${" ".repeat(100_000)}b.png`;
    const start = performance.now();
    expect(safeImageSrc(` \u0001${url}\u0001 `, undefined, { remote: false })).toBe(url);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("reads network paths as the URL parser does, without a base too", async () => {
    // Backslashes, tabs and leading control characters still name another host in the browser.
    const md = [
      String.raw`<img src="\\evil.test/raw.png">`,
      "",
      String.raw`![x](/\evil.test/md.png)`,
      "",
      String.raw`<video poster="\\evil.test/poster.png"></video><svg><image href="/\evil.test/svg.png"/></svg>`,
      String.raw`<table background="\\evil.test/table.png"><tr><td>a</td></tr></table>`,
      '<img src="ht&#9;tps://evil.test/tab.png"><img src="&#1;//evil.test/ctl.png">',
    ].join("\n");
    const off = await render(md, { remoteImages: false });
    expect(off.html).not.toContain("evil.test");
    expect(off.warnings.filter((w) => w.includes("remote images are off"))).toHaveLength(7);
    const on = await render(md);
    expect(on.dom.querySelector("img")?.getAttribute("src")).toBe("https://evil.test/raw.png");
    // In a local file a host is a network (UNC) share, not a local file.
    const doc = "file:///C:/docs/doc.md";
    expect(safeImageSrc("file://srv/share/a.png", doc)).toBeUndefined();
    expect(safeImageSrc(String.raw`\\srv\share\a.png`, doc, { remote: false })).toBeUndefined();
    expect(safeImageSrc("img/a.png", doc, { remote: false })).toBe("file:///C:/docs/img/a.png");
    // On the CLI's loopback http server a network path to that origin stays local http, remote images off too.
    const served = "http://127.0.0.1:4100/input/doc.md";
    expect(safeImageSrc(String.raw`\\127.0.0.1:4100/img.png`, served, { remote: false })).toBe(
      "http://127.0.0.1:4100/img.png",
    );
    expect(safeImageSrc("//evil.test/a.png", served)).toBe("https://evil.test/a.png");
  });

  it("maps relative images through the asset resolver (dropped folders)", async () => {
    const resolveAsset = (path: string) => (path === "img/shot.png" ? "blob:https://studio.dev/1" : undefined);
    const { dom } = await render('![s](./img/shot.png) <img src="img/shot.png?v=2">', {
      resolveAsset,
      remoteImages: false,
    });
    expect(Array.from(dom.querySelectorAll("img"), (i) => i.getAttribute("src"))).toEqual([
      "blob:https://studio.dev/1",
      "blob:https://studio.dev/1",
    ]);
    expect(assetPath("img/../img/./my%20shot.png#x")).toBe("img/my shot.png");
    expect([assetPath("../up.png"), assetPath("/root.png"), assetPath("a\\b.png")]).toEqual([
      "../up.png",
      "root.png",
      "a/b.png",
    ]);
  });

  it("escapes raw HTML when allowHtml is false", async () => {
    const { dom } = await render("<b>bold</b>", { allowHtml: false });
    expect(dom.querySelector("b")).toBeNull();
    expect(dom.querySelector("p")?.textContent).toBe("<b>bold</b>");
  });

  it.each([
    ["https://a.dev/x", "https://a.dev/x"],
    ["#top", "#top"],
    ["docs/a.md", "https://h.dev/base/docs/a.md"],
    [" JavaScript:alert(1)", undefined],
    ["data:text/html,x", undefined],
  ])("safeHref(%s)", (url, expected) => {
    expect(safeHref(url, "https://h.dev/base/")).toBe(expected);
  });
});

describe("helpers", () => {
  it("splits YAML front matter but not a leading thematic break", () => {
    expect(splitFrontMatter('---\ntitle: "Hi"\nx: 1\n---\n# Body')).toEqual({ body: "# Body", title: "Hi" });
    expect(splitFrontMatter("---\n\nText\n---\n").body).toBe("---\n\nText\n---\n");
  });

  it("slugifies like GitHub", () => {
    expect(slugify("What's new in v2.0?")).toBe("whats-new-in-v20");
  });
});

describe("markdownAdapter.load", () => {
  const fake = (): SnapshotDom & { calls: [string, SnapshotHtmlOptions][] } => {
    const calls: [string, SnapshotHtmlOptions][] = [];
    return {
      calls,
      snapshot: async () => {
        throw new Error("unused");
      },
      snapshotHtml: async (html, opts) => {
        calls.push([html, opts]);
        const bp: Blueprint = {
          version: 1,
          source: { type: "x" },
          size: { w: opts.width, h: 100 },
          background: "#fff",
          layers: [],
        };
        return bp;
      },
    };
  };

  it("clamps the width, passes theme CSS and fills the source", async () => {
    const snap = fake();
    const adapter = createMarkdownAdapter({ snapshot: snap });
    const { blueprint } = await adapter.load(
      { name: "guide.md", text: "# Guide\n\nHello" },
      { document, width: 2000, theme: "dark", maxLayers: 99 },
    );
    const [html, opts] = snap.calls[0] ?? [];
    expect(opts).toMatchObject({ width: 920, scheme: "dark", maxLayers: 99, background: "#0E0E16" });
    expect(opts?.css).toContain(".loom-doc");
    expect(html).toContain('<article class="loom-doc" data-scheme="dark"');
    expect(blueprint.source).toEqual({ type: "markdown", name: "guide.md", title: "Guide" });

    await adapter.load({ text: "x" }, { document, width: 100, theme: "light" });
    expect(snap.calls[1]?.[1].width).toBe(360);
  });

  it("turns remote images off for one load when the host passes ctx.network none", async () => {
    const snap = fake();
    const off: MarkdownLoadContext = { document, width: 800, theme: "light", network: "none" };
    const { warnings } = await createMarkdownAdapter({ snapshot: snap }).load(
      { text: '![x](https://tracker.example/p.png) <img src="https://tracker.example/q.png">' },
      off,
    );
    expect(snap.calls[0]?.[0]).not.toContain("tracker.example");
    expect(warnings.some((w) => w.includes("remote images are off"))).toBe(true);
  });

  it.each([
    ["no input", {}, /needs text, bytes or url/],
    ["oversize text", { text: "x".repeat(4 * 1024 * 1024 + 1) }, /over the 4.0 MB limit/],
  ])("rejects %s", async (_label, input, message) => {
    const adapter = createMarkdownAdapter({ snapshot: fake() });
    await expect(adapter.load(input, { document, width: 800, theme: "light" })).rejects.toThrow(message);
  });
});
