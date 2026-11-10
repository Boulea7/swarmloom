import type { Layer, TextLayer } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { displayValue } from "../src/capture/form";
import { domAdapter, snapshot, snapshotHtml } from "../src/index";
import { type DupNode, detectDuplicates } from "../src/post/duplicates";
import { truncate } from "../src/post/order";
import { rewriteUrls, splitTopLevel } from "../src/util/css";
import { isDangerousUrl, safeImageUrl, safeLinkUrl } from "../src/util/html";

const BASE = "https://example.org/docs/page.html";

function text(id: string, y: number, extra: Partial<TextLayer> = {}): TextLayer {
  return { id, kind: "text", box: { x: 0, y, w: 100, h: 20 }, html: id, text: id, style: {}, ...extra };
}

function node(start: number, end: number, y: number, children: DupNode[] = []): DupNode {
  return { tag: "article", classes: "card", box: { x: 0, y, w: 200, h: 120 }, start, end, children };
}

describe("option and input validation", () => {
  it.each([
    [{ maxLayers: 0 }, RangeError],
    [{ maxLayers: 2.5 }, RangeError],
    [{ maxHeight: -1 }, RangeError],
    [{ origin: "page" }, TypeError],
    [{ prescroll: "yes" }, TypeError],
    [{ showFormValues: 1 }, TypeError],
    [{ screenshot: { src: "", scrollX: 0, scrollY: 0, dpr: 1 } }, TypeError],
  ])("snapshot rejects %j", async (opts, error) => {
    await expect(snapshot(document, opts as never)).rejects.toThrow(error);
  });

  it("rejects roots and adapter inputs that are not DOM nodes", async () => {
    await expect(snapshot({} as never)).rejects.toThrow(TypeError);
    await expect(snapshot(document.createElement("div"))).rejects.toThrow(/connected/);
    await expect(snapshotHtml("<p>x</p>", { width: Number.NaN })).rejects.toThrow(RangeError);
    await expect(snapshotHtml("<p>x</p>", { width: 300, baseUrl: "relative/" })).rejects.toThrow(TypeError);
    expect(domAdapter.id).toBe("dom");
    await expect(domAdapter.load({}, { document, width: 800, theme: "light" })).rejects.toThrow(TypeError);
  });
});

describe("form values", () => {
  it("masks values unless revealed and always masks secrets", () => {
    const name = document.createElement("input");
    name.value = "Ada Lovelace";
    expect(displayValue(name, false)).toBe("\u2022\u2022\u2022 \u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
    expect(displayValue(name, true)).toBe("Ada Lovelace");
    const secret = document.createElement("input");
    secret.type = "password";
    secret.value = "hunter2";
    expect(displayValue(secret, true)).toBe("\u2022".repeat(7));
  });
});

describe("URL safety", () => {
  it.each([
    ["img/a.png", "https://example.org/docs/img/a.png", "https://example.org/docs/img/a.png"],
    ["javascript:alert(1)", null, null],
    ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA", null],
    ["data:text/html,<script>1</script>", null, null],
    ["mailto:a@example.org", null, "mailto:a@example.org"],
    ["  ", null, null],
  ])("%s -> image %s, link %s", (url, image, link) => {
    expect(safeImageUrl(url, BASE)).toBe(image);
    expect(safeLinkUrl(url, BASE)).toBe(link);
  });

  it("spots script URLs hidden by whitespace and case", () => {
    expect(isDangerousUrl(" java\tScript:alert(1)")).toBe(true);
    expect(isDangerousUrl("DATA:text/html,x")).toBe(true);
    expect(isDangerousUrl("https://example.org/javascript:")).toBe(false);
  });

  it("rewrites CSS url() tokens and drops refused ones", () => {
    const value = 'url("a.png"), linear-gradient(red, blue), url(javascript:x)';
    expect(splitTopLevel(value)).toHaveLength(3);
    const out = rewriteUrls(value, (u) => (u.startsWith("javascript:") ? null : `https://cdn.test/${u}`));
    expect(out).toBe('url("https://cdn.test/a.png"), linear-gradient(red, blue), none');
  });
});

describe("post-processing", () => {
  it("truncates far content first, keeps fixed UI and repairs references", () => {
    const layers: Layer[] = [
      { id: "b1", kind: "box", box: { x: 0, y: 0, w: 800, h: 3000 }, style: {} },
      text("t1", 100, { parent: "b1" }),
      { id: "b2", kind: "box", box: { x: 0, y: 1000, w: 800, h: 100 }, style: {}, parent: "b1" },
      text("t2", 2050, { parent: "b2", master: "t1" }),
      text("t3", 2100, { parent: "b1" }),
      text("fab", 700),
    ];
    // The page was captured scrolled to y = 2000; the fixed button is screen UI.
    const cut = truncate(layers, 4, new Set(["fab"]), { x: 0, y: 2000, w: 800, h: 800 });
    expect(cut.dropped).toBe(2);
    expect(cut.layers.map((l) => l.id)).toEqual(["b1", "t2", "t3", "fab"]);
    const t2 = cut.layers[1];
    expect(t2?.parent).toBe("b1");
    expect(t2?.master).toBeUndefined();
  });

  it("marks repeated sibling subtrees as duplicates of the first one", () => {
    const layers: Layer[] = [];
    const cards: DupNode[] = [];
    for (let i = 0; i < 4; i++) {
      const y = i * 140;
      layers.push({ id: `b${i}`, kind: "box", box: { x: 0, y, w: 200, h: 120 }, style: {} }, text(`t${i}`, y + 10));
      cards.push(node(i * 2, i * 2 + 2, y));
    }
    // A long single paragraph is prose and never copied.
    layers.push(text("p", 600, { text: "x".repeat(200) }));
    const prose: DupNode = {
      tag: "p",
      classes: "",
      box: { x: 0, y: 600, w: 200, h: 20 },
      start: 8,
      end: 9,
      children: [],
    };
    const root: DupNode = {
      tag: "main",
      classes: "",
      box: { x: 0, y: 0, w: 800, h: 700 },
      start: 0,
      end: 9,
      children: [...cards, prose],
    };
    expect(detectDuplicates(root, layers)).toBe(6);
    expect(layers[0]?.master).toBeUndefined();
    expect(layers[6]?.master).toBe("b0");
    expect(layers[7]?.master).toBe("t0");
    expect(layers[8]?.master).toBeUndefined();
  });
});
