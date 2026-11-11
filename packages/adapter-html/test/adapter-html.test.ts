// @vitest-environment jsdom
// DOMPurify needs a conformant DOM: happy-dom passes scripts through, so this suite runs in jsdom.
import type { SnapshotDom, SnapshotHtmlOptions } from "@swarmloom/adapter-code";
import type { Blueprint } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  createHtmlAdapter,
  decodeHtml,
  type HtmlLoadContext,
  isFullDocument,
  prepareDocument,
  rewriteCssUrls,
} from "../src/index";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("detection and decoding", () => {
  it.each([
    ["<!-- c -->\n<!DOCTYPE html><p>x", true],
    ["<html><body>x</body></html>", true],
    ["<section><h1>Hi</h1></section>", false],
  ])("isFullDocument(%j) = %s", (html, full) => {
    expect(isFullDocument(html)).toBe(full);
  });

  it("decodes by BOM, transport charset, then <meta charset>", () => {
    // "é" in windows-1252 is 0xE9; invalid as UTF-8, so the meta label must win over the fallback.
    const latin = new Uint8Array([...new TextEncoder().encode('<meta charset="iso-8859-1"><p>'), 0xe9]);
    expect(decodeHtml(latin)).toContain("<p>é");
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
    expect(decodeHtml(gbk, "gbk")).toBe("你好");
  });
});

describe("prepareDocument", () => {
  const page =
    '<!DOCTYPE html><html><head><base href="sub/"><meta http-equiv="refresh" content="0;url=https://evil.dev">' +
    '<link rel="stylesheet" href="https://cdn.dev/x.css"><script>window.ran = 1</script><title> Demo </title></head>' +
    '<body onload="steal()"><img src="a.png" srcset="a@2x.png 2x" onerror="x()"><img src="http://x.dev/b.png">' +
    '<a href="javascript:alert(1)">go</a><iframe src="https://x.dev"></iframe><p style="background:url(bg.png)">t</p></body></html>';

  it("removes scripts, handlers, frames and remote style sheets, and pins our CSP first", () => {
    const out = prepareDocument(page, window, { baseUrl: "https://site.dev/docs/index.html" });
    const doc = parse(out.html);
    expect(out.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toMatchObject({ hadScripts: true, title: "Demo", baseUrl: "https://site.dev/docs/sub/" });
    expect(out.html).not.toMatch(/<script|onload|onerror|javascript:|<iframe|refresh|cdn\.dev/i);
    const head = Array.from(
      doc.head.children,
      (el) => el.getAttribute("http-equiv") ?? el.getAttribute("name") ?? el.tagName,
    );
    expect(head.slice(0, 4)).toEqual(["META", "Content-Security-Policy", "referrer", "BASE"]);
    const imgs = Array.from(doc.images, (img) => [img.getAttribute("src"), img.hasAttribute("srcset")]);
    expect(imgs).toEqual([
      ["https://site.dev/docs/sub/a.png", false],
      [null, false],
    ]);
    expect(doc.querySelector("p")?.getAttribute("style")).toContain('url("https://site.dev/docs/sub/bg.png")');
  });

  it("allows only https images and fonts by default, nothing remote with network none", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("img-src data: blob: https:");
    expect(csp).toContain("font-src data: blob: https:");
    expect(csp).toMatch(/script-src 'none'.*connect-src 'none'/);
    expect(contentSecurityPolicy({ network: "none" })).not.toContain("https:");
    expect(rewriteCssUrls("a{background:url(https://x.dev/i.png)}", "none")).toBe('a{background:url("data:,")}');
  });

  it("rejects documents over the element limit", () => {
    const big = `<!DOCTYPE html><body>${"<i></i>".repeat(50)}</body>`;
    expect(() => prepareDocument(big, window, { maxElements: 40 })).toThrow(/over the 40 limit/);
  });
});

describe("htmlAdapter.load (fragments)", () => {
  const fake = (): SnapshotDom & { calls: [string, SnapshotHtmlOptions][] } => {
    const calls: [string, SnapshotHtmlOptions][] = [];
    return {
      calls,
      snapshot: async () => {
        throw new Error("documents are covered by the browser tests");
      },
      snapshotHtml: async (html, opts) => {
        calls.push([html, opts]);
        const bp: Blueprint = {
          version: 1,
          source: { type: "x" },
          size: { w: opts.width, h: 10 },
          background: "#fff",
          layers: [],
        };
        return bp;
      },
    };
  };
  const ctx = { document, width: 900, theme: "light" as const };

  it("sanitizes the fragment, applies the network policy and reports what was skipped", async () => {
    const snap = fake();
    const adapter = createHtmlAdapter({ snapshot: snap, network: "none" });
    const result = await adapter.load(
      { name: "card.html", text: '<div onclick="x()">Hi<script>x()</script><img src="https://x.dev/a.png"></div>' },
      ctx,
    );
    const [html, opts] = snap.calls[0] ?? [];
    expect(html).toContain("<div>Hi<img");
    expect(html).not.toMatch(/onclick|<script|x\.dev/);
    expect(opts).toMatchObject({ width: 900, scheme: "light" });
    expect(result.blueprint.source).toMatchObject({ type: "html", name: "card.html" });
    expect(result.warnings).toEqual(["html: 1 resource reference skipped (remote resources are off)"]);
  });

  it("turns remote loading off for one load when the host passes ctx.network none", async () => {
    const snap = fake();
    const adapter = createHtmlAdapter({ snapshot: snap });
    const input = { text: '<p>Hi<img src="https://tracker.example/p.png"></p>' };
    const off: HtmlLoadContext = { ...ctx, network: "none" };
    const result = await adapter.load(input, off);
    expect(snap.calls[0]?.[0]).not.toContain("tracker.example");
    expect(result.warnings).toEqual(["html: 1 resource reference skipped (remote resources are off)"]);
    const unknown = { ...ctx, network: "any" };
    await expect(adapter.load(input, unknown)).rejects.toThrow(/unknown ctx.network policy/);
  });

  it.each([
    ["no input", {}, /needs text, bytes or url/],
    ["oversize bytes", { bytes: new Uint8Array(9 * 1024 * 1024) }, /over the 8.0 MB limit/],
    ["a non-http URL", { url: "javascript:alert(1)" }, /unsupported URL scheme/],
  ])("rejects %s", async (_label, input, message) => {
    await expect(createHtmlAdapter({ snapshot: fake() }).load(input, ctx)).rejects.toThrow(message);
  });

  it("rejects an unknown network policy up front", () => {
    expect(() => createHtmlAdapter({ network: "any" as never })).toThrow(/unknown network policy/);
  });
});
