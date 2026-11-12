import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentView, Stage, StageOptions } from "../../src/internal";
import { createRng } from "../../src/rng";
import { createStage, stageStats } from "../../src/stage";
import { animatedBitmapType } from "../../src/stage/layers/still-bitmap";
import { resolveTheme } from "../../src/theme";
import type { Blueprint, CursorShape, Layer, Plugin, Size } from "../../src/types";
import { harness } from "../engine/fakes";

const SHAPES: CursorShape[] = ["arrow", "crosshair", "ibeam", "pen", "hand", "grab", "move", "copy", "resize"];
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/** 1x1 GIF, red then blue, looping: shown as is, it flips on the browser clock. */
const GIF_RED_BLUE =
  "data:image/gif;base64,R0lGODlhAQABAIABAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICTAEAOw==";

/**
 * Same-origin SVG whose SMIL animation runs on the browser clock when shown as is. A served path:
 * Vite would inline an imported asset this small as a data: URL.
 */
const SPIN_SVG = "/packages/core/test/stage/spin.svg";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function blueprint(layers: Layer[], size: Size = { w: 800, h: 600 }): Blueprint {
  return { version: 1, source: { type: "test" }, size, background: "#ffffff", layers };
}

function mount(
  layers: Layer[],
  extra: Partial<StageOptions> & { size?: Size; hostCss?: string; parent?: HTMLElement } = {},
): { stage: Stage; host: HTMLElement } {
  const parent = extra.parent ?? document.body;
  const host = parent.ownerDocument.createElement("div");
  host.style.cssText = extra.hostCss ?? "width:800px;height:600px;position:relative";
  parent.append(host);
  const bp = blueprint(layers, extra.size);
  const stage = createStage({
    blueprint: bp,
    mode: "inline",
    host,
    theme: resolveTheme("auto", bp, false),
    plugins: [],
    reducedMotion: false,
    rng: createRng(7),
    ...extra,
  });
  cleanups.push(() => {
    stage.destroy();
    host.remove();
  });
  return { stage, host };
}

/** Body of a srcdoc frame, as the Studio exports in: same origin as the page, location about:srcdoc. */
async function srcdocBody(): Promise<HTMLElement> {
  const frame = document.createElement("iframe");
  frame.style.cssText = "width:400px;height:200px;border:0";
  frame.srcdoc = "<!doctype html><body style=margin:0></body>";
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  cleanups.push(() => frame.remove());
  await loaded;
  return (frame.contentDocument as Document).body;
}

/** Renders frames at 16 ms steps until `promise` settles (fades are driven by engine time). */
async function drive(stage: Stage, promise: Promise<void>, start = 0): Promise<number> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  let t = start;
  for (let i = 0; i < 200 && !done; i++) {
    t += 16;
    stage.render(t, []);
    await Promise.resolve();
  }
  await promise;
  return t;
}

const css = (el: Element): CSSStyleDeclaration => getComputedStyle(el);
const outerOf = (el: Element): HTMLElement => el.closest("[data-layer]") as HTMLElement;

function agents(n: number): AgentView[] {
  const out: AgentView[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: i,
      name: `Agent ${i}`,
      label: i % 3 === 0 ? "" : `Agent ${i}`,
      color: ["#e5484d", "#3e63dd", "#30a46c", "#f76b15"][i % 4] as string,
      x: 20 + ((i * 97) % 760),
      y: 20 + ((i * 53) % 560),
      shape: SHAPES[i % SHAPES.length] as CursorShape,
      pressed: i % 5 === 0,
      bubble: i % 7 === 0 ? "typing heading" : "",
      alpha: 1,
      scale: 1,
    });
  }
  return out;
}

describe("stage: isolation and mounting", () => {
  it("renders into a closed shadow root with the blueprint background and css", () => {
    const { stage, host } = mount([
      { id: "t", kind: "text", box: { x: 10, y: 10, w: 200, h: 20 }, html: "<b>Hi</b>", text: "Hi", style: {} },
    ]);
    const el = host.querySelector("swarmloom-stage") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.shadowRoot).toBeNull();
    expect(stage.root.mode).toBe("closed");
    const scroller = stage.root.querySelector(".scroller") as HTMLElement;
    expect(css(scroller).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(stage.uiLayer.isConnected).toBe(true);
    // Content shorter than the container is centred: the view starts at or above the world top.
    const vp = stage.viewport();
    expect(vp.x).toBeLessThanOrEqual(0);
    expect(vp.y).toBeLessThanOrEqual(0);
    expect(vp.h).toBeGreaterThanOrEqual(600);
  });

  it("injects Blueprint.css into the world tree only", () => {
    const layers: Layer[] = [
      { id: "t", kind: "text", box: { x: 0, y: 0, w: 300, h: 30 }, html: '<p class="x">x</p>', text: "x", style: {} },
    ];
    const host = document.createElement("div");
    host.style.cssText = "width:400px;height:300px";
    document.body.append(host);
    const bp = { ...blueprint(layers), css: ".x{color:rgb(1, 2, 3)}" };
    const stage = createStage({
      blueprint: bp,
      mode: "inline",
      host,
      theme: resolveTheme("auto", bp, false),
      plugins: [],
      reducedMotion: false,
      rng: createRng(1),
    });
    cleanups.push(() => {
      stage.destroy();
      host.remove();
    });
    const p = stage.el("t")?.querySelector("p") as HTMLElement;
    expect(css(p).color).toBe("rgb(1, 2, 3)");
    const probe = document.createElement("p");
    probe.className = "x";
    document.body.append(probe);
    expect(css(probe).color).not.toBe("rgb(1, 2, 3)");
    probe.remove();
  });

  it("rejects invalid options with a TypeError", () => {
    expect(() => createStage({} as StageOptions)).toThrow(TypeError);
  });
});

describe("stage: reveal semantics per kind", () => {
  it("box: hidden, ghost cross-fading into the fill, final fill", () => {
    const { stage } = mount([
      { id: "b", kind: "box", box: { x: 20, y: 20, w: 200, h: 100 }, style: { background: "rgb(10, 20, 30)" } },
    ]);
    const el = stage.el("b") as HTMLElement;
    const outer = outerOf(el);
    expect(css(el).visibility).toBe("hidden");
    stage.reveal("b", 0.5);
    expect(css(el).visibility).toBe("visible");
    const ghost = outer.querySelector(".sl-g") as HTMLElement;
    expect(ghost).not.toBeNull();
    const fill = Number(css(el.parentElement as HTMLElement).opacity);
    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThan(1);
    expect(Number(css(ghost).opacity)).toBeGreaterThan(0);
    stage.reveal("b", 1);
    expect(outer.querySelector(".sl-g")).toBeNull();
    expect(css(el.parentElement as HTMLElement).opacity).toBe("1");
    expect(css(el).backgroundColor).toBe("rgb(10, 20, 30)");
  });

  it("text: typing keeps the final line wrapping and the caret follows real layout", () => {
    const text = "The quick brown fox jumps over the lazy dog while the swarm rebuilds every line of this page.";
    const { stage } = mount([
      {
        id: "t",
        kind: "text",
        box: { x: 40, y: 40, w: 180, h: 120 },
        html: `<span>${text}</span>`,
        text,
        style: { "font-size": "16px", "line-height": "20px", "font-family": "monospace" },
      },
    ]);
    const el = stage.el("t") as HTMLElement;
    /** Line tops of the text itself (wrapper elements excluded). */
    const lines = (): number[] => {
      const tops = new Set<number>();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const rect of r.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      return [...tops].sort((a, b) => a - b);
    };
    const height = (): number => el.scrollHeight;
    const finalLines = lines();
    const finalHeight = height();
    expect(finalLines.length).toBeGreaterThan(2);
    expect(css(el).visibility).toBe("hidden");
    for (const p of [0.25, 0.5, 0.75]) {
      stage.reveal("t", p);
      expect(css(el).visibility).toBe("visible");
      expect(lines()).toEqual(finalLines);
      expect(height()).toBe(finalHeight);
      const hidden = el.querySelector("sl-h") as HTMLElement;
      expect(hidden).not.toBeNull();
      expect(css(hidden).visibility).toBe("hidden");
    }
    const start = stage.caretAt("t", 0);
    const mid = stage.caretAt("t", 40);
    const end = stage.caretAt("t", [...text].length);
    expect(start.x).toBeGreaterThanOrEqual(39);
    expect(start.y).toBeGreaterThanOrEqual(39);
    expect(mid.y).toBeGreaterThan(start.y);
    expect(end.y).toBeGreaterThan(mid.y);
    expect(end.y).toBeLessThan(40 + 200);
    stage.finish("t");
    expect(el.querySelector("sl-h")).toBeNull();
    expect(el.textContent).toBe(text);
    expect(lines()).toEqual(finalLines);
  });

  it("path: stroke drawn along its length with dash offset, then cleaned up", () => {
    const { stage } = mount([
      {
        id: "p",
        kind: "path",
        box: { x: 0, y: 0, w: 300, h: 10 },
        d: "M0 5 L300 5",
        stroke: "rgb(200, 0, 0)",
        strokeWidth: 2,
        reveal: "pen",
      },
    ]);
    const svg = stage.el("p") as SVGSVGElement;
    const path = svg.querySelector("path") as SVGPathElement;
    stage.reveal("p", 0.5);
    expect(css(svg).visibility).toBe("visible");
    expect(path.style.strokeDasharray).not.toBe("");
    expect(Number.parseFloat(path.style.strokeDashoffset)).toBeCloseTo(150, 0);
    stage.reveal("p", 1);
    expect(path.style.strokeDasharray).toBe("");
  });

  it("path: accepts local url(#id) references and refuses external ones", () => {
    const { stage } = mount([
      {
        id: "p",
        kind: "path",
        box: { x: 0, y: 0, w: 100, h: 100 },
        d: "M0 0H100V100Z",
        fill: "url(#grad)",
        attrs: {
          "clip-path": "url(#clip)",
          mask: "url(https://evil.example/m.svg#m)",
          style: "mix-blend-mode:multiply",
        },
      },
    ]);
    const path = (stage.el("p") as SVGSVGElement).querySelector("path") as SVGPathElement;
    expect(path.getAttribute("fill")).toBe("url(#grad)");
    expect(path.getAttribute("clip-path")).toBe("url(#clip)");
    expect(path.getAttribute("mask")).toBeNull();
    expect(path.style.mixBlendMode).toBe("multiply");
  });

  it("image: sweep clip, fade, and decode through ready()", async () => {
    const { stage } = mount([
      { id: "s", kind: "image", box: { x: 0, y: 0, w: 100, h: 100 }, src: PNG_1PX },
      { id: "f", kind: "image", box: { x: 0, y: 120, w: 100, h: 100 }, src: PNG_1PX, reveal: "fade" },
      { id: "y", kind: "image", box: { x: 0, y: 240, w: 100, h: 88 }, src: PNG_1PX, reveal: "type" },
      { id: "h", kind: "image", box: { x: 0, y: 340, w: 100, h: 60 }, src: PNG_1PX, reveal: "type", lines: 1 },
    ]);
    await stage.ready();
    const sweep = stage.el("s") as HTMLElement;
    expect((sweep.querySelector("img") as HTMLImageElement).complete).toBe(true);
    const shell = sweep.parentElement as HTMLElement;
    stage.reveal("s", 0.5);
    expect(css(shell).clipPath).toMatch(/^inset\(0px 0px 50%( 0px)?\)$/);
    stage.reveal("s", 1);
    expect(css(shell).clipPath).toBe("none");
    const fade = stage.el("f") as HTMLElement;
    stage.reveal("f", 0.5);
    expect(Number(css(fade.parentElement as HTMLElement).opacity)).toBeCloseTo(0.5, 2);
    const typed = stage.el("y") as HTMLElement;
    stage.reveal("y", 0.5);
    expect(css(typed.parentElement as HTMLElement).clipPath).toMatch(/^polygon/);
    // A one-line crop (a large PDF heading) types at full height, not in 22 px bands.
    const heading = (stage.el("h") as HTMLElement).parentElement as HTMLElement;
    stage.reveal("h", 0.5);
    expect(css(heading).clipPath.replaceAll(" ", "")).toBe(
      "polygon(0px0px,100px0px,100px0px,50px0px,50px60px,0px60px)",
    );
  });

  const spinFile = (): string => new URL(SPIN_SVG, location.href).href;
  it.each([
    // Served from the page's own origin, as the CLI serves the files next to a document.
    { name: "SMIL in a same-origin .svg file", src: spinFile, x: 19.5 },
    {
      name: "CSS keyframes in a data: URL",
      src: () =>
        `data:image/svg+xml,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><style>@keyframes m{to{transform:translateX(150px)}}' +
            'rect{animation:m .83s linear infinite}</style><rect x="10" y="35" width="30" height="30" fill="#e33"/></svg>',
        )}`,
      x: 24.5,
    },
    // The Studio's export frame: its location (about:srcdoc) has no origin, the document has the page's.
    { name: "SMIL in a same-origin .svg file, staged in a srcdoc frame", src: spinFile, x: 19.5, srcdoc: true },
    {
      // A file opened in the Studio.
      name: "SMIL in a blob: URL",
      src: async () => {
        const url = URL.createObjectURL(await (await fetch(SPIN_SVG)).blob());
        cleanups.push(() => URL.revokeObjectURL(url));
        return url;
      },
      x: 19.5,
    },
  ])("image: an animated SVG ($name) holds still once decoded, whatever the wall time", async ({ src, x, srcdoc }) => {
    const parent = srcdoc ? await srcdocBody() : undefined;
    const layer: Layer = { id: "a", kind: "image", box: { x: 0, y: 0, w: 200, h: 100 }, src: await src() };
    const { stage } = mount([layer], { parent });
    // Shown, since an image nobody paints does not advance its animation.
    stage.reveal("a", 1);
    await stage.ready();
    const img = (stage.el("a") as HTMLElement).querySelector("img") as HTMLImageElement;
    // An <img> draws its current animation frame into a canvas: the mean x of the red shape.
    const redX = (): number => {
      const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (!g) return Number.NaN;
      g.canvas.width = 200;
      g.canvas.height = 100;
      g.drawImage(img, 0, 0, 200, 100);
      const d = g.getImageData(0, 0, 200, 100).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if ((d[i] ?? 0) > 200 && (d[i + 1] ?? 255) < 100) {
          sum += (i / 4) % 200;
          n++;
        }
      }
      return sum / n;
    };
    expect(redX()).toBeCloseTo(x, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(redX()).toBeCloseTo(x, 0);
  });

  it.each([
    { name: "data:", src: async () => GIF_RED_BLUE },
    {
      name: "blob:",
      src: async () => {
        const url = URL.createObjectURL(await (await fetch(GIF_RED_BLUE)).blob());
        cleanups.push(() => URL.revokeObjectURL(url));
        return url;
      },
    },
  ])("image: an animated GIF ($name URL) shows its first frame as a still copy", async ({ src }) => {
    const { stage } = mount([{ id: "g", kind: "image", box: { x: 0, y: 0, w: 40, h: 40 }, src: await src() }]);
    stage.reveal("g", 1);
    await stage.ready();
    const img = (stage.el("g") as HTMLElement).querySelector("img") as HTMLImageElement;
    // One frame: nothing left for the wall clock to play.
    expect(animatedBitmapType(new Uint8Array(await (await fetch(img.src)).arrayBuffer()))).toBeNull();
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    g?.drawImage(img, 0, 0);
    expect(Array.from(g?.getImageData(0, 0, 1, 1).data ?? [])).toEqual([255, 0, 0, 255]);
  });

  it.each<{ name: string; layer: Layer }>([
    {
      name: "an icon in a line of text",
      layer: {
        id: "g",
        kind: "text",
        box: { x: 0, y: 0, w: 200, h: 20 },
        html: `Status <img src="${GIF_RED_BLUE}" width="18" height="18"> online`,
        text: "Status online",
        style: {},
      },
    },
    {
      name: "a media snapshot",
      layer: { id: "g", kind: "media", box: { x: 0, y: 0, w: 40, h: 40 }, label: "", src: GIF_RED_BLUE },
    },
  ])("$name: an animated GIF shows its first frame as a still copy", async ({ layer }) => {
    const { stage } = mount([layer]);
    stage.reveal("g", 1);
    await stage.ready();
    const img = (stage.el("g") as HTMLElement).querySelector("img") as HTMLImageElement;
    expect(animatedBitmapType(new Uint8Array(await (await fetch(img.src)).arrayBuffer()))).toBeNull();
  });

  it("media: labelled placeholder that fades in", () => {
    const { stage } = mount([{ id: "m", kind: "media", box: { x: 0, y: 0, w: 320, h: 180 }, label: "Video" }]);
    const el = stage.el("m") as HTMLElement;
    const ph = el.querySelector(".sl-m") as HTMLElement;
    expect(ph.getAttribute("aria-label")).toBe("Video");
    expect(ph.textContent).toBe("Video");
    stage.reveal("m", 0.5);
    expect(Number(css(el.parentElement as HTMLElement).opacity)).toBeCloseTo(0.5, 2);
  });

  it("custom: plugin renderer and setup/cleanup lifecycle", () => {
    const calls: string[] = [];
    const plugin: Plugin = {
      name: "test",
      renderers: {
        "test:dot": {
          mount(_layer, container) {
            calls.push("mount");
            const d = document.createElement("i");
            container.append(d);
            return d;
          },
          reveal(_layer, p) {
            calls.push(`reveal:${p}`);
          },
          unmount() {
            calls.push("unmount");
          },
        },
      },
      setup(_stage, host) {
        calls.push(`setup:${host instanceof HTMLElement}`);
        return () => calls.push("cleanup");
      },
    };
    const { stage } = mount([{ id: "c", kind: "custom", box: { x: 0, y: 0, w: 50, h: 50 }, task: "test:dot" }], {
      plugins: [plugin],
    });
    expect(calls[0]).toBe("setup:true");
    expect(stage.el("c")?.localName).toBe("i");
    stage.reveal("c", 0.5);
    stage.destroy();
    expect(calls).toEqual(["setup:true", "mount", "reveal:0.5", "cleanup", "unmount"]);
  });

  it("text: carets read ahead in the read phase cost no layout reads while typing", () => {
    const text = "The quick brown fox jumps over the lazy dog while the swarm rebuilds every line of this page.";
    const layer: Layer = {
      id: "t",
      kind: "text",
      box: { x: 40, y: 40, w: 180, h: 120 },
      html: `<span>${text}</span>`,
      text,
      style: { "font-size": "16px", "line-height": "20px", "font-family": "monospace" },
    };
    const at = [0, 40, 70, text.length];
    const reference = mount([layer]).stage;
    const expected = at.map((n) => reference.caretAt("t", n));
    const { stage } = mount([layer]);
    /** Counts layout reads until stopped. */
    const spy = (): { count: () => number; stop: () => void } => {
      const range = vi.spyOn(Range.prototype, "getClientRects");
      const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
      return {
        count: () => range.mock.calls.length + rect.mock.calls.length,
        stop: () => {
          range.mockRestore();
          rect.mockRestore();
        },
      };
    };

    // A task starts on the text: its first caret block is read in the next read phase.
    stage.prefetch?.("t");
    stage.measure?.();
    let s = spy();
    stage.setStyle("t", { translate: "24px 0px" }); // a snap offset moves the text and its caret, not its glyphs
    stage.reveal("t", 0);
    const first = [stage.caretAt("t", 0)];
    stage.reveal("t", 40 / text.length);
    first.push(stage.caretAt("t", 40));
    expect(s.count()).toBe(0);
    s.stop();

    // Past the middle of the first block, the read phase takes the next one.
    stage.measure?.();
    s = spy();
    stage.reveal("t", 70 / text.length);
    const later = [stage.caretAt("t", 70)];
    stage.reveal("t", 1);
    later.push(stage.caretAt("t", text.length));
    expect(s.count()).toBe(0);
    s.stop();
    // The carets measured on demand, moved with the text (up to float noise from another place on the page).
    [...first, ...later].forEach((p, i) => {
      expect(p.x).toBeCloseTo((expected[i]?.x ?? Number.NaN) + 24, 3);
      expect(p.y).toBeCloseTo(expected[i]?.y ?? Number.NaN, 3);
    });
  });

  it("text: a caret read without a read phase takes every pending text along (seek frames)", () => {
    const text = "Typed while another agent starts on the next line.";
    const layer = (id: string, y: number): Layer => ({
      id,
      kind: "text",
      box: { x: 40, y, w: 400, h: 40 },
      html: `<span>${text}</span>`,
      text,
      style: { "font-size": "16px", "line-height": "20px" },
    });
    const { stage } = mount([layer("a", 40), layer("b", 120)]);
    stage.prefetch?.("a");
    stage.prefetch?.("b");
    stage.reveal("a", 0.5);
    // No read phase ran: this read forces a layout, and b's first block is read under it.
    stage.caretAt("a", 25);
    stage.reveal("a", 0.6);
    const range = vi.spyOn(Range.prototype, "getClientRects");
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const caret = stage.caretAt("b", 0);
    const reads = range.mock.calls.length + rect.mock.calls.length;
    range.mockRestore();
    rect.mockRestore();
    // Another read here would force a second layout after a's write.
    expect(reads).toBe(0);
    expect(caret.y).toBeGreaterThanOrEqual(120);
  });

  it("transient styles apply and finish() clears them", () => {
    const { stage } = mount([
      { id: "t", kind: "text", box: { x: 0, y: 0, w: 200, h: 30 }, html: "Title", text: "Title", style: {} },
    ]);
    const el = stage.el("t") as HTMLElement;
    stage.setStyle("t", { translate: "12px 4px", "font-size": "30px" });
    expect(el.style.getPropertyValue("translate")).toBe("12px 4px");
    expect(css(el).fontSize).toBe("30px");
    stage.finish("t");
    expect(el.style.getPropertyValue("translate")).toBe("");
    expect(el.style.getPropertyValue("font-size")).toBe("");
    expect(css(el).visibility).toBe("visible");
  });
});

describe("stage: virtualization", () => {
  /** 2000 boxes down a 100,000 px world, with the stage's mount counters. */
  function tallPage(): { stage: Stage; layers: Layer[]; stats: () => NonNullable<ReturnType<typeof stageStats>> } {
    const layers: Layer[] = [];
    for (let i = 0; i < 2000; i++) {
      layers.push({ id: `b${i}`, kind: "box", box: { x: 0, y: i * 50, w: 400, h: 40 }, style: { background: "#ccc" } });
    }
    const { stage } = mount(layers, { size: { w: 800, h: 100_000 } });
    return { stage, layers, stats: () => stageStats(stage) as NonNullable<ReturnType<typeof stageStats>> };
  }

  it("mounts near the viewport, unmounts far idle layers and restores their state", () => {
    const { stage, stats } = tallPage();
    expect(stats().domLayers).toBe(2000);
    expect(stats().keepAll).toBe(false);
    const initial = stats().mounted;
    expect(initial).toBeGreaterThan(10);
    expect(initial).toBeLessThan(100);

    stage.reveal("b0", 1);
    stage.finish("b0");
    stage.scrollTo(50_000);
    expect(stage.viewport().y).toBeCloseTo(50_000, 3);
    for (let f = 1; f <= 130; f++) stage.render(f * 16, []);
    const far = stats();
    expect(far.unmounts).toBeGreaterThan(0);
    expect(far.mounted).toBeLessThan(200);
    // Mounted by virtualization already: el() does not mount it again.
    const before = far.mounts;
    expect(stage.el("b1000")).not.toBeNull();
    expect(stats().mounts).toBe(before);

    stage.scrollTo(0);
    stage.render(130 * 16 + 16, []);
    const b0 = stage.el("b0") as HTMLElement;
    expect(css(b0).visibility).toBe("visible");
    expect(outerOf(b0).querySelector(".sl-g")).toBeNull();
    expect(stats().peak).toBeLessThan(400);
  });

  it("a whole-page reveal (finish now, reduced motion) mounts only near the view", () => {
    const { stage, layers, stats } = tallPage();
    for (const l of layers) stage.reveal(l.id, 0.5);
    expect(stats().mounted).toBeLessThan(100);
    // A far layer comes back with its recorded progress once the view reaches it.
    stage.scrollTo(50_000);
    stage.render(16, []);
    const fill = Number(css((stage.el("b1000") as HTMLElement).parentElement as HTMLElement).opacity);
    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThan(1);
  });

  it("a seek keeps virtualizing: layers built on the way unmount once the tour passes them", () => {
    const { stage, stats } = tallPage();
    const h = harness(stage.blueprint, { follow: "tour", intro: false, agents: 12 }, { stage });
    void h.engine.play();
    h.engine.seek(40_000);
    // About 200 boxes (10,000 px of page) built; the view band itself holds about 50.
    expect(h.engine.progress.built).toBeGreaterThan(150);
    expect(stats().mounted).toBeLessThan(120);
    h.engine.destroy();
  });

  it("reports user scrolls but not programmatic ones", async () => {
    const layers: Layer[] = [{ id: "b", kind: "box", box: { x: 0, y: 0, w: 100, h: 100 }, style: {} }];
    const { stage } = mount(layers, { size: { w: 800, h: 5000 } });
    const seen: number[] = [];
    stage.onUserScroll((y) => seen.push(y));
    const scroller = stage.root.querySelector(".scroller") as HTMLElement;
    stage.scrollTo(400);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(seen).toEqual([]);
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    scroller.scrollTop = 900;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(seen.length).toBeGreaterThan(0);
    expect(stage.scrollY).toBeGreaterThan(800);
    expect(seen.at(-1)).toBeCloseTo(stage.scrollY, 3);
  });

  it("a tour seek writes the scroller once, when it draws", () => {
    const { stage } = tallPage();
    const scroller = stage.root.querySelector(".scroller") as HTMLElement;
    const h = harness(stage.blueprint, { follow: "tour", intro: false, agents: 12 }, { stage });
    void h.engine.play();
    const own = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop") as PropertyDescriptor;
    let writes = 0;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => own.get?.call(scroller),
      set: (v: number) => {
        writes++;
        own.set?.call(scroller, v);
      },
    });
    h.engine.seek(20_000);
    expect(stage.scrollY).toBeGreaterThan(1000);
    // A write per undrawn frame landed after that frame's task writes and forced a layout.
    expect(writes).toBe(1);
    const world = stage.root.querySelector(".world") as HTMLElement;
    expect(world.getBoundingClientRect().top).toBeCloseTo(stage.toClient({ x: 0, y: 0 }).y, 0);
    h.engine.destroy();
  });
});

describe("stage: overlays and canvas", () => {
  it("keeps the world in its own stacking context when it fits at scale 1", () => {
    // A world exactly as wide as the scroller's client area gets no transform; without a stacking
    // context of its own, layers with a z-index would paint over the cursor canvas.
    const fit = (mount([]).stage.root.querySelector(".scroller") as HTMLElement).clientWidth;
    const { stage } = mount([], { size: { w: fit, h: 1200 } });
    const world = stage.root.querySelector(".world") as HTMLElement;
    expect(css(world).transform).toBe("none");
    expect(css(world).isolation).toBe("isolate");
  });

  it("draws overlay handles and clears them on remove", () => {
    const { stage } = mount([]);
    const canvas = stage.root.querySelector("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const dpr = canvas.width / Number.parseFloat(canvas.style.width);
    const alphaAt = (x: number, y: number): number =>
      (ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3] as number) ?? 0;
    const h = stage.overlay("ghost-rect", { x: 100, y: 100, w: 200, h: 100, fill: true });
    stage.render(16, []);
    expect(alphaAt(200, 150)).toBeGreaterThan(0);
    h.update({ x: 400 });
    stage.render(32, []);
    expect(alphaAt(200, 150)).toBe(0);
    expect(alphaAt(500, 150)).toBeGreaterThan(0);
    h.remove();
    stage.render(48, []);
    expect(alphaAt(500, 150)).toBe(0);
    expect(() => {
      for (const kind of ["size-badge", "rubber-band", "anchor", "guide", "measure", "selection", "caret", "halo"]) {
        stage.overlay(kind, {
          x: 50,
          y: 50,
          w: 80,
          h: 40,
          x1: 0,
          y1: 0,
          x2: 90,
          y2: 90,
          text: "80 × 40",
          axis: "x",
          pos: 120,
          a: { x: 0, y: 0, w: 10, h: 10 },
          b: { x: 40, y: 0, w: 10, h: 10 },
          r: 30,
          level: 0.5,
        });
      }
      stage.setRulers(true);
      for (let f = 4; f < 40; f++) stage.render(f * 16, []);
    }).not.toThrow();
  });

  it("draws 48 agents at DPR 2 and reports the render cost", () => {
    const desc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    cleanups.push(() => {
      if (desc) Object.defineProperty(window, "devicePixelRatio", desc);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    });
    const { stage } = mount([]);
    const canvas = stage.root.querySelector("canvas") as HTMLCanvasElement;
    const list = agents(48);
    stage.render(0, list);
    expect(canvas.width).toBe(Math.round(canvas.clientWidth * 2));
    for (let f = 1; f <= 30; f++) stage.render(f * 16, list);
    const frames = 300;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const a = list[f % list.length] as AgentView;
      a.x = (a.x + 3) % 780;
      stage.render(1000 + f * 16, list);
    }
    const ms = (performance.now() - t0) / frames;
    console.info(`[stage] render() with 48 agents at DPR 2: ${ms.toFixed(3)} ms/frame`);
    expect(ms).toBeLessThan(16);
  });
});

describe("stage: lifecycle", () => {
  it("overlay: top layer under <html>, page inert while covered, go-live restores and removes the host", async () => {
    const page = document.createElement("div");
    page.style.height = "3000px";
    document.body.append(page);
    const htmlStyleBefore = document.documentElement.getAttribute("style");
    cleanups.push(() => page.remove());
    const layers: Layer[] = [{ id: "b", kind: "box", box: { x: 0, y: 0, w: 100, h: 100 }, style: {} }];
    const bp = blueprint(layers, { w: window.innerWidth, h: 3000 });
    const stage = createStage({
      blueprint: bp,
      mode: "overlay",
      host: document.body,
      theme: resolveTheme("auto", bp, false),
      plugins: [],
      reducedMotion: false,
      rng: createRng(3),
      initialScroll: 0,
    });
    cleanups.push(() => stage.destroy());
    const host = document.documentElement.querySelector(":scope > swarmloom-stage") as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.parentElement).toBe(document.documentElement);
    if (typeof host.showPopover === "function") expect(host.matches(":popover-open")).toBe(true);
    expect(host.inert).toBe(false);

    const t = await drive(stage, stage.enter());
    expect(page.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    stage.scrollTo(700);
    stage.render(t + 16, []);
    await drive(stage, stage.goLive(), t + 16);
    expect(host.isConnected).toBe(false);
    expect(page.inert).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.documentElement.getAttribute("style")).toBe(htmlStyleBefore);
    expect(Math.round(window.scrollY)).toBe(700);
    window.scrollTo(0, 0);
  });

  it("overlay: enter() focuses the scroller, but a replay leaves focus on the stage's toolbar", async () => {
    const bp = blueprint([], { w: window.innerWidth, h: 2000 });
    const stage = createStage({
      blueprint: bp,
      mode: "overlay",
      host: document.body,
      theme: resolveTheme("auto", bp, false),
      plugins: [],
      reducedMotion: false,
      rng: createRng(3),
      initialScroll: 0,
    });
    cleanups.push(() => stage.destroy());
    const t = await drive(stage, stage.enter());
    expect((stage.root.activeElement as HTMLElement | null)?.classList.contains("scroller")).toBe(true);
    // Mounted like the toolbar's seek bar: its own shadow root on the UI layer.
    const toolbar = document.createElement("div");
    const control = document.createElement("input");
    toolbar.attachShadow({ mode: "open" }).append(control);
    stage.uiLayer.append(toolbar);
    control.focus();
    // A seek back replays the build: reset() then enter() again.
    stage.reset();
    await drive(stage, stage.enter(), t);
    expect(toolbar.shadowRoot?.activeElement).toBe(control);
  });

  it("inline: go-live keeps content and hides the canvas layers; reset blanks it again", async () => {
    const { stage, host } = mount([
      { id: "b", kind: "box", box: { x: 0, y: 0, w: 100, h: 100 }, style: { background: "red" } },
    ]);
    await stage.enter();
    stage.finishAll();
    const el = stage.el("b") as HTMLElement;
    expect(css(el).visibility).toBe("visible");
    await stage.goLive();
    expect(host.querySelector("swarmloom-stage")).not.toBeNull();
    expect(css(el).visibility).toBe("visible");
    expect(stage.root.querySelector(".root[data-live]")).not.toBeNull();
    stage.reset();
    stage.render(16, []);
    const again = stage.el("b") as HTMLElement;
    expect(css(again).visibility).toBe("hidden");
    expect(stage.root.querySelector(".root[data-live]")).toBeNull();
  });

  it("inline: live content is read and its links take Tab focus; the build is neither", async () => {
    const { stage } = mount([
      {
        id: "t",
        kind: "text",
        box: { x: 0, y: 0, w: 400, h: 40 },
        text: "Read the accessible destination",
        html: 'Read <a href="https://example.com/">the accessible destination</a>',
        style: {},
      },
    ]);
    await stage.enter();
    stage.finishAll();
    const world = stage.root.querySelector(".world") as HTMLElement;
    const link = (stage.el("t") as HTMLElement).querySelector("a") as HTMLAnchorElement;
    const focused = (): Element | null => (link.getRootNode() as ShadowRoot).activeElement;
    link.focus();
    expect(focused()).toBeNull();
    expect(world.getAttribute("aria-hidden")).toBe("true");

    await stage.goLive();
    expect(world.hasAttribute("aria-hidden")).toBe(false);
    expect(link.tabIndex).toBe(0);
    link.focus();
    expect(focused()).toBe(link);

    // Replay: the build is a replay again and focus stays on the stage, not lost to <body>.
    stage.reset();
    expect(world.getAttribute("aria-hidden")).toBe("true");
    expect((stage.root.activeElement as HTMLElement | null)?.classList.contains("scroller")).toBe(true);
  });

  it("inline: a container without a height gets the content's aspect ratio", () => {
    const { stage } = mount([], { size: { w: 800, h: 400 }, hostCss: "width:600px" });
    const vp = stage.viewport();
    expect(vp.w).toBeCloseTo(800, 0);
    expect(vp.h).toBeGreaterThan(350);
    expect(vp.h).toBeLessThan(450);
  });

  it("destroy removes the host and later calls are no-ops", () => {
    const { stage, host } = mount([{ id: "b", kind: "box", box: { x: 0, y: 0, w: 10, h: 10 }, style: {} }]);
    stage.destroy();
    expect(host.querySelector("swarmloom-stage")).toBeNull();
    expect(() => {
      stage.reveal("b", 1);
      stage.render(16, agents(3));
      stage.overlay("ghost-rect", {}).remove();
      stage.destroy();
    }).not.toThrow();
    expect(stage.el("b")).toBeNull();
  });
});
