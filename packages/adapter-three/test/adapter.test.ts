/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomLayer, Plugin, Rect, StageApi } from "@swarmloom/core";
import { describe, expect, it, vi } from "vitest";
import { createThreeAdapter, THREE_TASKS, ThreeAdapterError, threeAdapter } from "../src/index";
import { ModelScene } from "../src/runtime/scene";
import { driveBuild } from "./helpers/drive";

const ctx = { document, width: 800, theme: "light" as const };
const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/3d");

/** ASCII STL of a unit cube (12 triangles). */
function cubeStl(): string {
  const v = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [2, 3, 7],
    [2, 7, 6],
    [1, 2, 6],
    [1, 6, 5],
    [0, 4, 7],
    [0, 7, 3],
  ];
  const facets = faces.map(
    (f) =>
      `facet normal 0 0 0\nouter loop\n${f.map((i) => `vertex ${(v[i] as number[]).join(" ")}`).join("\n")}\nendloop\nendfacet`,
  );
  return `solid cube\n${facets.join("\n")}\nendsolid cube\n`;
}

/** Union of the patch layer boxes: where the model sits on the stage. */
function footprint(layers: readonly CustomLayer[]): Rect {
  const boxes = layers.filter((l) => l.task === THREE_TASKS.patch).map((l) => l.box);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
}

function plyHeader(vertices: number): string {
  return `ply\nformat binary_little_endian 1.0\nelement vertex ${vertices}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
}

describe("three adapter", () => {
  it("plans a mesh as points, edges, patches, materials and a light sweep that build to completion", async () => {
    const adapter = createThreeAdapter({ height: 600 });
    const source = await adapter.load({ name: "cube.stl", text: cubeStl() }, ctx);
    const { blueprint } = source;

    expect(blueprint.source.type).toBe("three");
    expect(blueprint.size).toEqual({ w: 800, h: 600 });
    expect(blueprint.plugins).toEqual(["three"]);
    expect(blueprint.truncated).toBeUndefined();
    const tasks = new Set(blueprint.layers.map((l) => (l as CustomLayer).task));
    expect(tasks).toEqual(new Set(Object.values(THREE_TASKS)));
    const ids = new Set(blueprint.layers.map((l) => l.id));
    expect(ids.size).toBe(blueprint.layers.length);
    for (const layer of blueprint.layers) if (layer.parent) expect(ids.has(layer.parent)).toBe(true);

    const report = driveBuild(source, 3);
    expect(report.finished.size).toBe(blueprint.layers.length);
    expect(report.openOverlays).toBe(0);
    expect(report.sounds).toContain("note");
    for (const p of report.targets) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
    source.dispose?.();
  });

  it("loads the shuttle sample identically from GLB, OBJ, Z-up STL and PLY", async () => {
    const footprints: Record<string, Rect> = {};
    for (const file of ["shuttle.glb", "shuttle.obj", "shuttle.stl", "shuttle.ply"]) {
      const bytes = new Uint8Array(await readFile(join(SAMPLES, file)));
      const source = await threeAdapter.load({ name: file, bytes }, ctx);
      const layers = source.blueprint.layers as CustomLayer[];
      expect(source.blueprint.truncated, file).toBeUndefined();
      expect(new Set(layers.map((l) => l.task)), file).toEqual(new Set(Object.values(THREE_TASKS)));
      footprints[file] = footprint(layers);
      source.dispose?.();
    }
    // Same shape, same stage footprint: parsers, welding and the STL Z-up conversion agree.
    const reference = footprints["shuttle.glb"] as Rect;
    for (const [file, box] of Object.entries(footprints)) {
      for (const key of ["x", "y", "w", "h"] as const)
        expect(box[key], `${file} ${key}`).toBeCloseTo(reference[key], 0);
    }
  });

  it("takes reduced motion from the player, not the host's media query", async () => {
    // No GPU needed: happy-dom has no WebGL, so the mount shows its notice, but the setting is decided first.
    const source = await createThreeAdapter({ height: 600 }).load({ name: "cube.stl", text: cubeStl() }, ctx);
    const plugin = source.plugins?.[0] as Plugin;
    const mount = vi.spyOn(ModelScene.prototype, "mount");
    const media = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({ matches: query.includes("reduced-motion"), media: query }) as MediaQueryList);
    try {
      for (const reducedMotion of [false, true]) {
        const cleanup = plugin.setup?.({ reducedMotion } as StageApi, document.createElement("div"));
        expect((mount.mock.contexts.at(-1) as ModelScene).reducedMotion, `player ${reducedMotion}`).toBe(reducedMotion);
        if (typeof cleanup === "function") cleanup();
      }
    } finally {
      media.mockRestore();
      mount.mockRestore();
      source.dispose?.();
    }
  });

  it.each([
    ["empty input", { name: "a.glb", bytes: new Uint8Array(0) }, "empty"],
    ["unknown bytes", { name: "a.bin", bytes: Uint8Array.from([1, 2, 3, 4, 5, 6]) }, "unsupported-format"],
    [
      "glTF with an external buffer",
      {
        name: "a.gltf",
        text: JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "a.bin", byteLength: 4 }] }),
      },
      "external-resource",
    ],
    ["glTF 1.0", { name: "a.gltf", text: JSON.stringify({ asset: { version: "1.0" } }) }, "unsupported-format"],
    ["PLY declaring more vertices than allowed", { name: "a.ply", text: plyHeader(99_000_000) }, "too-large"],
    ["PLY shorter than its header", { name: "a.ply", text: plyHeader(1000) }, "invalid"],
  ])("rejects %s", async (_label, input, code) => {
    const error = await threeAdapter.load(input, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ThreeAdapterError);
    expect((error as ThreeAdapterError).code).toBe(code);
  });

  it("sniffs strong signatures and leaves other text alone", () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(threeAdapter.sniff?.(bytes("glTF\u0002\u0000\u0000\u0000"))).toBe(true);
    expect(threeAdapter.sniff?.(bytes("ply\nformat ascii 1.0\n"))).toBe(true);
    expect(threeAdapter.sniff?.(bytes("# cube\nv 0 0 0\nv 1 0 0\nf 1 2 3\n"))).toBe(true);
    expect(threeAdapter.sniff?.(bytes("# Title\n\nSome markdown text.\n"))).toBe(false);
    expect(threeAdapter.sniff?.(bytes('{"name": "package", "version": "1.0.0"}'))).toBe(false);
  });
});
