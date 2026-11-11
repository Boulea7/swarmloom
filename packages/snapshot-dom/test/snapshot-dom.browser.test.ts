import type { Blueprint, Layer, TextLayer } from "@swarmloom/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import demoHtml from "../../../examples/web/demo.html?raw";
import { domAdapter, snapshot, snapshotHtml } from "../src/index";

const VIEW_W = 1280;
const VIEW_H = 800;
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const f of frames.splice(0)) f.remove();
});

/** Loads a full HTML document into a same-origin iframe of the given viewport size. */
async function mountPage(html: string, w = VIEW_W, h = VIEW_H): Promise<Document> {
  const frame = document.createElement("iframe");
  frame.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;border:0`;
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  frames.push(frame);
  await loaded;
  const doc = frame.contentDocument;
  if (!doc) throw new Error("iframe document unavailable");
  return doc;
}

function texts(bp: Blueprint): TextLayer[] {
  return bp.layers.filter((l): l is TextLayer => l.kind === "text");
}

function textWith(bp: Blueprint, needle: string): TextLayer | undefined {
  return texts(bp).find((t) => t.text.includes(needle));
}

function countByKind(layers: readonly Layer[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of layers) out[l.kind] = (out[l.kind] ?? 0) + 1;
  return out;
}

describe("snapshot of the demo page", () => {
  it("captures every layer kind the page contains", async () => {
    const doc = await mountPage(demoHtml);
    const bp = await snapshot(doc);
    const stats = countByKind(bp.layers);
    console.info(`[snapshot-dom] demo layers: ${bp.layers.length} ${JSON.stringify(stats)}`);
    expect(bp.version).toBe(1);
    expect(bp.size.w).toBe(VIEW_W);
    expect(bp.viewport).toEqual({ w: VIEW_W, h: VIEW_H });
    expect(bp.source.title).toContain("Loomworks");
    expect(bp.icon).toMatch(/^data:image\/svg\+xml/);
    expect(stats.box).toBeGreaterThan(30);
    expect(stats.text).toBeGreaterThan(60);
    expect(stats.image).toBeGreaterThanOrEqual(10); // inline SVG icons and the canvas
    expect(stats.path).toBeGreaterThanOrEqual(1); // <hr> and single-side borders
    expect(stats.guide).toBeGreaterThanOrEqual(1);
    expect(new Set(bp.layers.map((l) => l.id)).size).toBe(bp.layers.length);
    // Hidden content is skipped and secrets never leave the page.
    expect(textWith(bp, "Hidden probe")).toBeUndefined();
    expect(JSON.stringify(bp)).not.toContain("warp-and-weft");
    expect(JSON.stringify(bp)).not.toContain("second draft");
    // Pseudo-element badge from attr() and the fixed help button.
    expect(textWith(bp, "New")).toBeDefined();
    expect(texts(bp).some((t) => t.text.trim() === "?")).toBe(true);
  });

  it("marks the repeated pattern cards as duplicates of the first card", async () => {
    const bp = await snapshot(await mountPage(demoHtml));
    const master = textWith(bp, "Indigo twill");
    const copy = textWith(bp, "Violet overshot");
    expect(master?.master).toBeUndefined();
    expect(copy?.master).toBe(master?.id);
    const cardCopies = texts(bp).filter((t) => t.master === master?.id);
    expect(cardCopies.length).toBe(7);
  });

  it("derives alignment guides with snapping members", async () => {
    const bp = await snapshot(await mountPage(demoHtml));
    const guides = bp.layers.filter((l) => l.kind === "guide");
    expect(guides.length).toBeGreaterThan(0);
    expect(guides.length).toBeLessThanOrEqual(24);
    const ids = new Set(guides.map((g) => g.id));
    const snapping = bp.layers.filter((l) => l.snaps?.some((s) => ids.has(s)));
    expect(snapping.length).toBeGreaterThan(0);
  });

  it("captures open shadow root content and slotted children", async () => {
    const bp = await snapshot(await mountPage(demoHtml));
    const note = textWith(bp, "of the bolt is woven");
    expect(note?.text).toContain("72%");
    expect(textWith(bp, "Weaving progress")).toBeDefined();
  });

  it("unrolls the inner scroller so content beyond its viewport is captured", async () => {
    const bp = await snapshot(await mountPage(demoHtml));
    const end = textWith(bp, "End of the inner scroller");
    expect(end).toBeDefined();
    expect(end?.box.y).toBeGreaterThan(VIEW_H);
    expect(bp.size.h).toBeGreaterThanOrEqual((end?.box.y ?? 0) + (end?.box.h ?? 0));
    // The sticky header is captured once, at its natural position.
    expect(texts(bp).filter((t) => t.text.trim() === "New pattern").length).toBe(1);
  });

  it("truncates to maxLayers through the dom adapter, keeps fixed UI and reports it", async () => {
    const doc = await mountPage(demoHtml);
    const ctx = { document, width: VIEW_W, theme: "light" as const, maxLayers: 25 };
    const { blueprint: bp } = await domAdapter.load({ element: doc.documentElement, name: "demo.html" }, ctx);
    expect(bp.source).toMatchObject({ type: "dom", name: "demo.html" });
    expect(bp.layers.length).toBeLessThanOrEqual(25);
    expect(bp.truncated?.dropped).toBeGreaterThan(0);
    expect(bp.truncated?.reason).toContain("25");
    expect(texts(bp).some((t) => t.text.trim() === "?")).toBe(true);
    const ids = new Set(bp.layers.map((l) => l.id));
    for (const l of bp.layers) {
      if (l.parent) expect(ids.has(l.parent)).toBe(true);
      if (l.master) expect(ids.has(l.master)).toBe(true);
    }
  });

  it("stays fast on the demo and on a synthetic 5000-element page", async () => {
    const doc = await mountPage(demoHtml);
    await snapshot(doc);
    let t0 = performance.now();
    await snapshot(doc);
    const demoMs = performance.now() - t0;
    const rows: string[] = [];
    for (let i = 0; i < 1000; i++) {
      rows.push(
        `<div class="row r${i % 7}"><span class="n">#${i}</span><b>Item ${i}</b><em>${i % 3 ? "open" : "done"}</em><i class="tag">t${i % 11}</i></div>`,
      );
    }
    const css =
      ".row{display:flex;gap:8px;padding:4px 8px;border-bottom:1px solid #ddd}.tag{background:#eef;border-radius:4px;padding:0 4px}";
    const big = await mountPage(
      `<!doctype html><html><head><style>${css}</style></head><body>${rows.join("")}</body></html>`,
    );
    expect(big.querySelectorAll("body *").length).toBe(5000);
    t0 = performance.now();
    const bp = await snapshot(big);
    const bigMs = performance.now() - t0;
    console.info(
      `[snapshot-dom] demo: ${demoMs.toFixed(1)} ms (target < 150), 5000 elements: ${bigMs.toFixed(1)} ms (target < 1500), layers ${bp.layers.length}`,
    );
    expect(bp.layers.length).toBeGreaterThan(1000);
    // Loose bounds: the machine is shared; the report carries the real numbers.
    expect(demoMs).toBeLessThan(1500);
    expect(bigMs).toBeLessThan(15000);
  });
});

/** Left edge (viewport px) of the first glyph of `needle` inside `root`. */
function glyphLeft(root: Node, needle: string): number {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n as Text).data.indexOf(needle);
    if (i < 0) continue;
    const range = doc.createRange();
    range.setStart(n, i);
    range.setEnd(n, i + 1);
    return range.getBoundingClientRect().left;
  }
  throw new Error(`text not found: ${needle}`);
}

/** Lays a text layer out on its own, as a stage would, and returns where `needle` starts. */
function rebuiltGlyphLeft(layer: TextLayer, needle: string): number {
  const el = document.createElement("div");
  const { x, y, w, h } = layer.box;
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;box-sizing:border-box`;
  for (const [k, v] of Object.entries(layer.style)) el.style.setProperty(k, v);
  el.innerHTML = layer.html;
  document.body.append(el);
  try {
    return glyphLeft(el, needle);
  } finally {
    el.remove();
  }
}

describe("edge cases", () => {
  it("keeps text next to inline controls where it was laid out", async () => {
    const doc = await mountPage(
      '<body style="margin:0;font:16px/1.5 sans-serif"><div style="padding:20px">' +
        '<label id="a"><input type="checkbox" checked> Public pattern</label>' +
        '<div id="b" style="text-align:center"><button>Go</button> after the button</div></div></body>',
    );
    const bp = await snapshot(doc);
    for (const needle of ["Public", "after"]) {
      const layer = textWith(bp, needle) as TextLayer;
      expect(layer).toBeDefined();
      expect(Math.abs(rebuiltGlyphLeft(layer, needle) - glyphLeft(doc.body, needle))).toBeLessThan(1.5);
    }
  });

  it("evaluates CSS counters in generated content", async () => {
    const doc = await mountPage(
      "<style>body{margin:0;font:16px sans-serif}ol{list-style:none}.s{counter-reset:step}.s li{counter-increment:step}" +
        '.s li::before{content:"0" counter(step) ". "}.n{counter-reset:sec 3}' +
        '.n p::before{content:counters(sec, "-", upper-roman) " ";counter-increment:sec}' +
        '.m li::before{content:counter(list-item) ") "}</style>' +
        '<ol class="s"><li>Pick</li><li>Plan</li></ol>' +
        '<div class="n"><p>Alpha</p><div style="counter-reset:sec"><p>Beta</p></div></div>' +
        '<ol class="m" start="4"><li>Four</li><li>Five</li></ol>' +
        '<ol class="m" reversed start="9"><li>Nine</li><li>Eight</li></ol>' +
        '<ol class="m" reversed><li>Zero</li><li>Minus</li></ol>',
    );
    const bp = await snapshot(doc);
    const expected = ["01. Pick", "02. Plan", "IV Alpha", "IV-I Beta", "4) Four", "5) Five", "9) Nine", "8) Eight"];
    // Chromium counts a reversed list without a start attribute down from 0 for counter(list-item).
    expected.push("0) Zero", "-1) Minus");
    for (const want of expected) expect(textWith(bp, want.split(" ").at(-1) as string)?.text).toContain(want);
  });

  it("counts CSS counters within the walk's slices", async () => {
    const items = Array.from({ length: 1000 }, (_, i) => `<li>Item ${i}</li>`).join("");
    const doc = await mountPage(`<style>li::before{content:counter(list-item) ". "}</style><ol>${items}</ol>`);
    const view = doc.defaultView as Window;
    const read = view.getComputedStyle.bind(view);
    let reads = 0;
    view.getComputedStyle = (el: Element, pseudo?: string | null) => {
      if (pseudo) reads++;
      return read(el, pseudo);
    };
    // Pseudo-element reads between two turns of the host; a clock that runs 1 ms per call keeps
    // each slice to about ten steps, whatever the machine's speed.
    let worst = 0;
    let seen = 0;
    const ping = new MessageChannel();
    ping.port1.onmessage = () => {
      worst = Math.max(worst, reads - seen);
      seen = reads;
      ping.port2.postMessage(null);
    };
    ping.port2.postMessage(null);
    let t = performance.now();
    const clock = vi.spyOn(performance, "now").mockImplementation(() => ++t);
    try {
      const bp = await snapshot(doc, { maxHeight: 1e6 });
      expect(textWith(bp, "Item 999")?.text).toContain("1000. Item 999");
    } finally {
      clock.mockRestore();
      ping.port1.close();
    }
    expect(Math.max(worst, reads - seen)).toBeLessThan(200);
  });

  it("captures an open modal dialog and its backdrop into the screen layer", async () => {
    const doc = await mountPage(
      '<body style="margin:0;height:3000px"><div style="transform:translateX(10px);overflow:hidden;height:40px">' +
        '<p>Clipped host</p><dialog id="d" style="width:300px"><p>Delete this pattern?</p></dialog></div></body>',
    );
    doc.defaultView?.scrollTo(0, 400);
    (doc.getElementById("d") as HTMLDialogElement).showModal();
    const bp = await snapshot(doc);
    const prompt = textWith(bp, "Delete this pattern") as TextLayer;
    const real = (doc.querySelector("dialog p") as Element).getBoundingClientRect();
    // Screen-layer content keeps viewport coordinates, escapes the ancestor clip and paints last.
    expect(prompt.box.y).toBeCloseTo(real.top, 0);
    expect(prompt.clip).toBeUndefined();
    const backdrop = bp.layers.find((l) => l.meta?.backdrop === true);
    expect(backdrop?.box).toMatchObject({ x: 0, y: 0, w: VIEW_W, h: VIEW_H });
    const order = bp.layers.filter((l) => l.kind !== "guide").map((l) => l.id);
    expect(order.indexOf(backdrop?.id ?? "")).toBeGreaterThan(order.indexOf(textWith(bp, "Clipped host")?.id ?? ""));
    expect(order.at(-1)).toBe(prompt.id);
  });

  it("serialises inline SVG with safe SMIL animation and without its own transform", async () => {
    const doc = await mountPage(
      '<body><svg width="120" height="120" viewBox="0 0 120 120" style="transform:translateY(-10px)"><a href="#x"><circle cx="60" cy="60" r="40" fill="tomato">' +
        '<animate attributeName="r" values="40;50;40" dur="2s" repeatCount="indefinite"/>' +
        '<set attributeName="href" to="javascript:alert(1)"/></circle></a></svg></body>',
    );
    const bp = await snapshot(doc);
    const image = bp.layers.find((l) => l.kind === "image");
    expect(image?.meta?.smil).toBe(true);
    const markup = decodeURIComponent(image?.kind === "image" ? image.src : "");
    expect(markup).toContain("<animate");
    expect(markup).not.toContain("javascript");
    // The root's own transform is already part of the layer box; baking it in would apply it twice.
    expect(markup).not.toContain("transform");
  });

  it("honours prescroll, inlineImages and screenshot", async () => {
    const doc = await mountPage(
      '<body style="margin:0"><div data-swarmloom-media="Map" style="width:100px;height:50px"></div>' +
        '<img id="pic" width="40" height="40"><div style="height:2500px"></div><p id="late">waiting</p>' +
        "<script>new IntersectionObserver((e)=>{if(e[0].isIntersecting)document.getElementById('late').textContent='Revealed on scroll'}).observe(document.getElementById('late'))</script></body>",
    );
    const canvas = doc.createElement("canvas");
    canvas.width = canvas.height = 40;
    const g = canvas.getContext("2d") as CanvasRenderingContext2D;
    g.fillStyle = "#0a7";
    g.fillRect(0, 0, 40, 40);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob)));
    const pic = doc.getElementById("pic") as HTMLImageElement;
    pic.src = URL.createObjectURL(blob);
    await pic.decode();
    doc.defaultView?.scrollTo(0, 120);
    const shot = { src: canvas.toDataURL("image/png"), scrollX: 0, scrollY: 0, dpr: 1 };
    const bp = await snapshot(doc, { prescroll: true, inlineImages: true, screenshot: shot });
    expect(doc.defaultView?.scrollY).toBe(120);
    expect(textWith(bp, "Revealed on scroll")).toBeDefined();
    const image = bp.layers.find((l) => l.kind === "image");
    expect(image?.kind === "image" && image.src.startsWith("data:image/png")).toBe(true);
    const media = bp.layers.find((l) => l.kind === "media");
    expect(media?.kind === "media" && media.label).toBe("Map");
    expect(media?.kind === "media" && media.src?.startsWith("data:image/")).toBe(true);
  });
});

describe("long pages", () => {
  /** Rows of 100 px, with fixed help UI nested in a footer at the end of the DOM. */
  function longPage(rows: number): string {
    const body = Array.from({ length: rows }, (_, i) => `<div class="row">Row ${i}</div>`).join("");
    return (
      "<!doctype html><html><head><style>body{margin:0}.row{height:100px;border-bottom:1px solid #ccc}</style></head>" +
      `<body>${body}<footer><div><span style="position:fixed;right:8px;bottom:8px">Help</span></div></footer></body></html>`
    );
  }

  it("walks in time slices, so an abort from another task stops it", async () => {
    const doc = await mountPage(longPage(3000));
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 0);
    await expect(snapshot(doc, { maxHeight: 1e9, signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([{ maxHeight: 2000 }, { maxLayers: 10 }])(
    "skips paint reads past the cut of %j and keeps fixed UI",
    async (opts) => {
      const doc = await mountPage(longPage(1000));
      const view = doc.defaultView as Window;
      const read = view.getComputedStyle.bind(view);
      let pseudoReads = 0;
      view.getComputedStyle = (el: Element, pseudo?: string | null) => {
        if (pseudo) pseudoReads++;
        return read(el, pseudo);
      };
      const bp = await snapshot(doc, opts);
      expect(textWith(bp, "Help")).toBeDefined();
      expect(bp.truncated?.dropped).toBeGreaterThan(0);
      // A fully walked row reads its ::before and ::after; rows past the cut are not read at all.
      expect(pseudoReads).toBeLessThan(600);
    },
  );
});

describe("snapshotHtml", () => {
  it("lays out a fragment in a sandbox with its origin at (0,0) and cleans up", async () => {
    const w = window as Window & { __pwned?: number };
    const bp = await snapshotHtml(
      '<h1 style="margin:0">Hello sandbox</h1><p>Body text <a href="javascript:alert(1)">link</a></p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="window.__pwned=1"><script>window.__pwned=2</script>',
      { width: 480, css: ".sl-root{padding:0;background:#fffdf5}" },
    );
    expect(bp.size.w).toBe(480);
    expect(bp.source.type).toBe("html");
    expect(bp.css).toContain("#fffdf5");
    const title = textWith(bp, "Hello sandbox");
    expect(title?.box.x).toBeCloseTo(0, 0);
    expect(title?.box.y).toBeCloseTo(0, 0);
    for (const l of bp.layers) {
      expect(l.box.x).toBeGreaterThanOrEqual(-0.01);
      expect(l.box.y).toBeGreaterThanOrEqual(-0.01);
    }
    expect(JSON.stringify(bp)).not.toContain("javascript:");
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(w.__pwned).toBeUndefined();
  });

  it("copies verbatim markup whole for the blueprint CSS to lay out", async () => {
    const bp = await snapshotHtml(
      '<p>Sum <span class="f" data-swarmloom-verbatim style="background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)">' +
        '<span class="up">k</span><svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 0h10" onclick="x()"></path></svg></span> end</p>' +
        '<div role="math"><span class="d" data-swarmloom-verbatim><span class="up">n</span></span></div>',
      { width: 400, css: ".up{display:block;position:relative;top:-0.5em}.d{display:block;margin:1em 0}" },
    );
    expect(texts(bp).map((t) => [t.text, t.role, t.html])).toEqual([
      [
        "Sum k end",
        "paragraph",
        'Sum <span class="f"><span class="up">k</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path d="M0 0h10"></path></svg></span> end',
      ],
      ["n", "math", '<span class="d" style="margin:0;"><span class="up">n</span></span>'],
    ]);
  });

  it("rejects invalid widths and removes the sandbox when aborted", async () => {
    await expect(snapshotHtml("<p>x</p>", { width: 0 })).rejects.toThrow(RangeError);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(snapshotHtml("<p>x</p>", { width: 300, signal: ctrl.signal })).rejects.toThrow();
    expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
  });
});
