import type { ImageLayer, Layer, PathLayer } from "@swarmloom/core";
import { beforeAll, describe, expect, it } from "vitest";
import sceneUrl from "../../../examples/image/scene.webp?url";
import { createImageAdapter, imageAdapter } from "../src/index";

const ctx = { document, width: 640, theme: "light" as const };
let scene: Uint8Array;

beforeAll(async () => {
  scene = new Uint8Array(await (await fetch(sceneUrl)).arrayBuffer());
});

function expectInside(layers: readonly Layer[], size: { w: number; h: number }): void {
  for (const l of layers) {
    expect(l.box.x, l.id).toBeGreaterThanOrEqual(0);
    expect(l.box.y, l.id).toBeGreaterThanOrEqual(0);
    expect(l.box.x + l.box.w, l.id).toBeLessThanOrEqual(size.w + 0.01);
    expect(l.box.y + l.box.h, l.id).toBeLessThanOrEqual(size.h + 0.01);
  }
}

const isSketch = (l: Layer): l is PathLayer => l.kind === "path" && l.meta?.sketch === true;
const isTile = (l: Layer): l is ImageLayer => l.kind === "image" && l.meta?.tile === true;

describe("imageAdapter on the sample scene", () => {
  it("sketches with the pen, paints quadtree tiles biggest first and fades in the full image", async () => {
    expect(scene.byteLength).toBeLessThan(200 * 1024);
    const { blueprint, dispose } = await imageAdapter.load({ bytes: scene, name: "scene.webp" }, ctx);
    try {
      expect(blueprint.size).toEqual({ w: 640, h: 427 });
      expect(blueprint.source).toMatchObject({ type: "image", title: "scene.webp" });
      expect(blueprint.truncated).toBeUndefined();
      expectInside(blueprint.layers, blueprint.size);

      const sketch = blueprint.layers.filter(isSketch);
      const tiles = blueprint.layers.filter(isTile);
      expect(sketch.length).toBeGreaterThan(20);
      expect(sketch.length).toBeLessThanOrEqual(160);
      expect(tiles.length).toBeGreaterThan(50);
      expect(tiles.length).toBeLessThanOrEqual(256);
      expect(blueprint.layers).toHaveLength(sketch.length + tiles.length + 1);

      // Order: sketch, then tiles, then the final fade.
      expect(blueprint.layers.slice(0, sketch.length)).toEqual(sketch);
      const last = blueprint.layers.at(-1) as ImageLayer;
      expect(last).toMatchObject({ kind: "image", reveal: "fade", box: { x: 0, y: 0, w: 640, h: 427 } });
      expect(last.meta).toMatchObject({ final: true, format: "webp", natural: { w: 960, h: 640 }, animated: false });

      for (const s of sketch) {
        expect(s).toMatchObject({ reveal: "pen", fill: "none", role: "sketch" });
        expect(s.d).toMatch(/^M[\d.]+ [\d.]+/);
      }
      for (let i = 1; i < tiles.length; i++) {
        const [a, b] = [tiles[i - 1] as ImageLayer, tiles[i] as ImageLayer];
        expect(a.box.w * a.box.h).toBeGreaterThanOrEqual(b.box.w * b.box.h - 0.01);
      }
      for (const t of tiles) {
        expect(t).toMatchObject({ reveal: "paint", src: last.src, natural: { w: 960, h: 640 } });
        const c = t.crop as { x: number; y: number; w: number; h: number };
        expect(c.x + c.w).toBeLessThanOrEqual(960);
        expect(c.y + c.h).toBeLessThanOrEqual(640);
      }
      // Tiles cover the picture.
      const area = tiles.reduce((s, t) => s + t.box.w * t.box.h, 0);
      expect(area / (640 * 427)).toBeCloseTo(1, 1);

      // The blob URL decodes and is released on dispose.
      const img = new Image();
      img.src = last.src;
      await img.decode();
      expect(img.naturalWidth).toBe(960);
    } finally {
      dispose?.();
    }
  });

  it("gives identical results with the worker and on the calling thread", async () => {
    const a = await createImageAdapter({ worker: true }).load({ bytes: scene }, ctx);
    const b = await createImageAdapter({ worker: false }).load({ bytes: scene }, ctx);
    expect(a.blueprint.layers.at(-1)?.meta?.analysis).toBe("worker");
    expect(b.blueprint.layers.at(-1)?.meta?.analysis).toBe("sync");
    const strip = (layers: Layer[]): unknown[] =>
      layers.map((l) => ({ ...l, src: undefined, meta: { ...l.meta, analysis: undefined } }));
    expect(strip(a.blueprint.layers)).toEqual(strip(b.blueprint.layers));
    a.dispose?.();
    b.dispose?.();
  });

  it("respects the layer budget and reports what was left out", async () => {
    const { blueprint, dispose } = await imageAdapter.load({ bytes: scene }, { ...ctx, maxLayers: 21 });
    expect(blueprint.layers.length).toBeLessThanOrEqual(21);
    expect(blueprint.layers.filter(isSketch)).toHaveLength(8);
    expect(blueprint.truncated?.reason).toMatch(/layer limit of 21/);
    expect(blueprint.truncated?.dropped).toBeGreaterThan(0);
    dispose?.();
    const only = await imageAdapter.load({ bytes: scene }, { ...ctx, maxLayers: 1, theme: "dark" });
    expect(only.blueprint.layers).toHaveLength(1);
    expect(only.blueprint).toMatchObject({ background: "#0b0b12", scheme: "dark" });
    only.dispose?.();
  });

  it("inlines the image as a data URL on request and rejects corrupt data", async () => {
    const { blueprint } = await createImageAdapter({ inlineAssets: true, maxTiles: 4, maxStrokes: 4 }).load(
      { bytes: scene },
      ctx,
    );
    expect((blueprint.layers.at(-1) as ImageLayer).src).toMatch(/^data:image\/webp;base64,/);
    expect(blueprint.layers.length).toBeLessThanOrEqual(9);
    const corrupt = scene.slice(0, 64);
    await expect(imageAdapter.load({ bytes: corrupt }, ctx)).rejects.toThrow();
  });
});
