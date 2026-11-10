import type { CustomLayer, Layer, LoadedSource, PathLayer, StageApi, TextLayer } from "@swarmloom/core";
import { afterEach, describe, expect, it } from "vitest";
import chart from "../../../examples/svg/chart.svg?raw";
import emblem from "../../../examples/svg/emblem.svg?raw";
import { createSvgAdapter, DEFS_TASK, type SvgDefsData, svgAdapter, svgPlugin } from "../src/index";

const ctx = { document, width: 640, theme: "light" as const };

function expectInside(layers: readonly Layer[], size: { w: number; h: number }): void {
  for (const l of layers) {
    expect(l.box.w, l.id).toBeGreaterThan(0);
    expect(l.box.h, l.id).toBeGreaterThan(0);
    expect(l.box.x, l.id).toBeGreaterThanOrEqual(-0.5);
    expect(l.box.y, l.id).toBeGreaterThanOrEqual(-0.5);
    expect(l.box.x + l.box.w, l.id).toBeLessThanOrEqual(size.w + 0.5);
    expect(l.box.y + l.box.h, l.id).toBeLessThanOrEqual(size.h + 0.5);
  }
}

function byKind<K extends Layer["kind"]>(layers: readonly Layer[], kind: K): Extract<Layer, { kind: K }>[] {
  return layers.filter((l): l is Extract<Layer, { kind: K }> => l.kind === kind);
}

afterEach(() => {
  // The adapter must not leave its sandbox behind.
  expect(document.querySelector("[data-swarmloom-sandbox]")).toBeNull();
});

describe("svgAdapter on the samples", () => {
  it("rebuilds the emblem: pen strokes, traced fills, stage-space defs, duplicates and text", async () => {
    const loaded: LoadedSource = await svgAdapter.load({ text: emblem, name: "emblem.svg" }, ctx);
    const { blueprint, plugins } = loaded;
    expect(blueprint.size).toEqual({ w: 640, h: 640 });
    expect(blueprint.background).toBe("rgb(250, 246, 238)");
    expect(blueprint.source).toMatchObject({ type: "svg", title: "SwarmLoom emblem" });
    expect(blueprint.truncated).toBeUndefined();
    expectInside(blueprint.layers, blueprint.size);

    const paths = byKind(blueprint.layers, "path");
    const texts = byKind(blueprint.layers, "text");
    expect(paths.length).toBe(26);
    expect(texts.map((t) => t.text)).toEqual(["SWARMLOOM", "woven by many hands"]);
    expect(texts[1]?.html).toContain("<span");
    expect(paths.filter((p) => p.reveal === "pen").length).toBeGreaterThan(15);
    expect(paths.some((p) => p.reveal === "trace")).toBe(true);

    // Gradient strokes, clip paths and filters point into the defs layer, which the plugin renders.
    const defs = byKind(blueprint.layers, "custom")[0] as CustomLayer;
    expect(defs.task).toBe(DEFS_TASK);
    expect(blueprint.plugins).toEqual(["svg"]);
    expect(plugins).toEqual([svgPlugin]);
    const markup = (defs.data as SvgDefsData).markup;
    for (const p of paths) {
      for (const value of [p.fill, p.stroke, ...Object.values(p.attrs ?? {})]) {
        const id = /url\(#([^)]+)\)/.exec(value ?? "")?.[1];
        if (id) expect(markup, `${p.id} -> ${id}`).toContain(`id="${id}"`);
      }
    }
    expect(markup).toContain("<clipPath");
    expect(markup).toContain("<filter");

    // The second <use> of the shuttle symbol is built as a duplicate of the first.
    const duplicates = paths.filter((p) => p.master);
    expect(duplicates).toHaveLength(2);
    for (const dup of duplicates) expect(paths.find((p) => p.id === dup.master)?.meta?.tag).toBe(dup.meta?.tag);

    // Pen anchors come from the path commands, in stage coordinates.
    const warp = paths.find((p) => p.meta?.tag === "line") as PathLayer;
    expect(warp.meta?.anchors).toEqual([
      { x: 160, y: 80, start: true },
      { x: 160, y: 506.7 },
    ]);
    expect(warp.attrs?.["stroke-linecap"]).toBe("round");

    // Paint order is kept.
    const z = blueprint.layers.map((l) => l.z ?? 0);
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });

  it("rebuilds the chart: dashed grid, bars, line and labels in stage coordinates", async () => {
    const { blueprint } = await svgAdapter.load({ text: chart, name: "chart.svg" }, ctx);
    expect(blueprint.size).toEqual({ w: 640, h: 400 });
    expectInside(blueprint.layers, blueprint.size);
    const paths = byKind(blueprint.layers, "path");
    const texts = byKind(blueprint.layers, "text");
    expect(texts).toHaveLength(16);
    expect(texts[0]).toMatchObject({ text: "Threads woven per week", fontSize: 20 });
    const grid = paths.filter((p) => p.attrs?.["stroke-dasharray"] === "4 4");
    expect(grid).toHaveLength(4);
    const bars = paths.filter((p) => p.meta?.tag === "rect" && p.fill?.startsWith("url("));
    expect(bars).toHaveLength(9);
    expect(bars.every((b) => b.reveal === "trace")).toBe(true);
    const line = paths.find((p) => p.meta?.tag === "polyline") as PathLayer;
    expect(line).toMatchObject({ reveal: "pen", strokeWidth: 3, fill: "none" });
    expect(line.meta?.anchors).toHaveLength(8);
  });

  it("scales to the layout width and respects the layer limit", async () => {
    const { blueprint } = await createSvgAdapter({ maxLayers: 10 }).load({ text: chart }, { ...ctx, width: 320 });
    expect(blueprint.size).toEqual({ w: 320, h: 200 });
    expect(blueprint.layers).toHaveLength(10);
    expect(blueprint.truncated?.reason).toMatch(/layer limit/);
    // The chart has 40 drawable layers; kept content plus dropped accounts for all of them.
    const content = blueprint.layers.filter((l) => l.kind !== "custom").length;
    expect(content + (blueprint.truncated?.dropped ?? 0)).toBe(40);
    expectInside(blueprint.layers, blueprint.size);
    const limited = await svgAdapter.load({ text: chart }, { ...ctx, maxLayers: 5 });
    expect(limited.blueprint.layers).toHaveLength(5);
  });
});

describe("svgAdapter safety", () => {
  it("drops scripts, handlers, foreignObject and external resources without running anything", async () => {
    const w = window as unknown as { __pwned?: number };
    w.__pwned = 0;
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" onload="window.__pwned++">
      <script>window.__pwned++</script>
      <style>@import url(https://evil.test/a.css); rect { fill: url(https://evil.test/p.svg#p) red }</style>
      <foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>
      <a href="javascript:window.__pwned++"><rect width="50" height="50" onclick="window.__pwned++"/></a>
      <image href="https://evil.test/x.png" width="10" height="10"/>
      <use xlink:href="https://evil.test/s.svg#a"/>
      <set attributeName="onmouseover" to="window.__pwned++"/>
    </svg>`;
    const { blueprint } = await svgAdapter.load({ text: hostile }, { ...ctx, width: 100 });
    await new Promise((r) => setTimeout(r, 50));
    expect(w.__pwned).toBe(0);
    const json = JSON.stringify(blueprint);
    expect(json).not.toMatch(/evil\.test|javascript:|onload|onclick|foreignObject|<script/i);
    expect(blueprint.truncated?.reason).toMatch(/unsafe or external content removed/);
    // The rect survives, painted with its fallback colour.
    expect(byKind(blueprint.layers, "path")).toMatchObject([{ meta: { tag: "rect" } }]);
  });

  it("re-sanitises defs markup in the renderer", () => {
    const layer: CustomLayer = {
      id: "d",
      kind: "custom",
      task: DEFS_TASK,
      box: { x: 0, y: 0, w: 1, h: 1 },
      data: {
        markup:
          '<linearGradient id="g"><stop offset="0"/></linearGradient><script>alert(1)</script><image href="https://evil.test/x.png"/>',
      },
    };
    const host = document.createElement("div");
    const el = svgPlugin.renderers?.[DEFS_TASK]?.mount(layer, host, {} as StageApi) as SVGSVGElement;
    expect(el.querySelector("linearGradient#g")).not.toBeNull();
    expect(el.querySelector("script")).toBeNull();
    expect(el.innerHTML).not.toContain("evil.test");
    svgPlugin.renderers?.[DEFS_TASK]?.unmount?.(layer);
    expect(host.childElementCount).toBe(0);
  });

  it("stops expanding cyclic and exponential <use> references", async () => {
    const bomb = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs><g id="a"><use href="#a"/><rect width="1" height="1"/></g>
      <g id="b0"><rect width="2" height="2"/></g>
      ${Array.from({ length: 12 }, (_, i) => `<g id="b${i + 1}"><use href="#b${i}"/><use href="#b${i}"/></g>`).join("")}</defs>
      <use href="#a"/><use href="#b12"/></svg>`;
    const { blueprint } = await createSvgAdapter({ maxLayers: 50 }).load({ text: bomb }, { ...ctx, width: 100 });
    expect(blueprint.layers.length).toBeLessThanOrEqual(50);
    expect(blueprint.truncated).toBeDefined();
    const text = byKind(blueprint.layers, "text") as TextLayer[];
    expect(text).toHaveLength(0);
  });
});
