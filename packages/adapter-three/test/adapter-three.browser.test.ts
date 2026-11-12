import type { CustomLayer, LoadedSource, Plugin } from "@swarmloom/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createThreeAdapter, THREE_TASKS } from "../src/index";
import { driveBuild } from "./helpers/drive";

const SAMPLE = new URL("../../../examples/3d/loom-bot.glb", import.meta.url);
const SIZE = { w: 960, h: 600 };

/** WebGL 2 is what three r187 needs; headless Chromium normally has it through SwiftShader. */
function hasWebGL2(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

const webgl = hasWebGL2();
if (!webgl) console.warn("adapter-three browser test: WebGL 2 is unavailable in this browser; GPU checks are skipped.");

/** Reads one RGBA pixel of the canvas centre region and reports whether anything was drawn. */
function drewSomething(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = 40;
  const ctx2d = probe.getContext("2d") as CanvasRenderingContext2D;
  ctx2d.drawImage(canvas, 0, 0, probe.width, probe.height);
  const data = ctx2d.getImageData(0, 0, probe.width, probe.height).data;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] as number) > 0) opaque++;
  return opaque > 20;
}

describe("three adapter with the loom-bot sample", () => {
  let source: LoadedSource;
  let plugin: Plugin;
  let host: HTMLElement;

  beforeAll(async () => {
    const response = await fetch(SAMPLE);
    expect(response.ok).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    source = await createThreeAdapter({ height: SIZE.h }).load(
      { name: "loom-bot.glb", bytes },
      { document, width: SIZE.w, theme: "light" },
    );
    plugin = source.plugins?.[0] as Plugin;
    host = document.createElement("div");
    Object.assign(host.style, { width: `${SIZE.w}px`, height: `${SIZE.h}px`, position: "relative" });
    document.body.append(host);
  }, 60_000);

  afterAll(() => {
    source?.dispose?.();
    host?.remove();
  });

  it("loads into bounded patch layers for every task kind", () => {
    const { blueprint } = source;
    expect(blueprint.size).toEqual(SIZE);
    const byTask = new Map<string, number>();
    for (const layer of blueprint.layers as CustomLayer[]) byTask.set(layer.task, (byTask.get(layer.task) ?? 0) + 1);
    for (const task of Object.values(THREE_TASKS)) expect(byTask.get(task)).toBeGreaterThan(0);
    const patches = byTask.get(THREE_TASKS.patch) as number;
    expect(patches).toBeGreaterThan(8);
    expect(patches).toBeLessThanOrEqual(400);
  });

  it("projects every anchor inside the viewport", () => {
    const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= SIZE.w && p.y >= 0 && p.y <= SIZE.h;
    for (const layer of source.blueprint.layers as CustomLayer[]) {
      const data = layer.data as { taps?: { x: number; y: number }[]; sweep?: { x: number; y: number }[] };
      for (const p of [...(data.taps ?? []), ...(data.sweep ?? [])]) {
        const q = plugin.project?.(p) ?? p;
        expect(inside(q), `${layer.id} anchor ${JSON.stringify(q)}`).toBe(true);
      }
    }
  });

  it.skipIf(!webgl)(
    "renders on a WebGL backdrop, builds, orbits and keeps anchors on screen",
    { timeout: 180_000 },
    () => {
      // The host asks for reduced motion, the player does not: the player's setting decides (exports
      // pin it, so the finale orbit must not depend on the machine). adapter.test.ts checks the same
      // rule without a GPU, so it still runs where WebGL is missing and this case skips.
      const real = window.matchMedia.bind(window);
      const media = vi
        .spyOn(window, "matchMedia")
        .mockImplementation((query) =>
          query.includes("prefers-reduced-motion") ? ({ matches: true, media: query } as MediaQueryList) : real(query),
        );
      let cleanup: ReturnType<NonNullable<Plugin["setup"]>>;
      try {
        cleanup = plugin.setup?.({ reducedMotion: false } as never, host);
      } finally {
        media.mockRestore();
      }
      try {
        const canvas = host.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas).not.toBeNull();
        expect(canvas.getAttribute("aria-label")).toMatch(/3D model/);

        // Sparse frames keep the software rasteriser (SwiftShader) fast; the engine clock still advances exactly.
        const report = driveBuild(source, 12, 250);
        expect(report.finished.size).toBe(source.blueprint.layers.length);
        expect(report.openOverlays).toBe(0);
        // Let the finale orbit run, then check the drawing and the live projection.
        for (let t = 0; t < 8000; t += 100) plugin.frame?.(report.elapsed + t, 100);
        expect(drewSomething(canvas)).toBe(true);
        expect(canvas.style.pointerEvents).toBe("auto");
        const patch = source.blueprint.layers.find((l) => (l as CustomLayer).task === THREE_TASKS.patch) as CustomLayer;
        const centre = { x: patch.box.x + patch.box.w / 2, y: patch.box.y + patch.box.h / 2 };
        const moved = plugin.project?.(centre) ?? centre;
        expect(moved.x).toBeGreaterThanOrEqual(0);
        expect(moved.x).toBeLessThanOrEqual(SIZE.w);
        expect(moved.y).toBeGreaterThanOrEqual(0);
        expect(moved.y).toBeLessThanOrEqual(SIZE.h);
        expect(moved).not.toEqual(centre);
      } finally {
        if (typeof cleanup === "function") cleanup();
      }
      expect(host.querySelector("canvas")).toBeNull();
    },
  );

  it.skipIf(!webgl)("renders only the frames somebody sees, once, with what the others left", () => {
    // Every render clears the canvas first, so clear() calls count renders.
    const clear = vi.spyOn(WebGL2RenderingContext.prototype, "clear");
    const cleanup = plugin.setup?.({ reducedMotion: false } as never, host);
    try {
      // The fresh mount leaves a redraw: frames nobody sees (an export's ticks between two captured
      // frames) keep it for the next frame that draws. Long after the build nothing else moves.
      const t = 3_600_000;
      clear.mockClear();
      plugin.frame?.(t, 8, false);
      plugin.frame?.(t + 8, 8, false);
      expect(clear).not.toHaveBeenCalled();
      plugin.frame?.(t + 16, 8, true);
      expect(clear).toHaveBeenCalled();
      clear.mockClear();
      plugin.frame?.(t + 24, 8, true);
      expect(clear).not.toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      if (typeof cleanup === "function") cleanup();
    }
  });

  it.skipIf(!webgl)("does not render the finale orbit on its own between the frames somebody sees", async () => {
    const clear = vi.spyOn(WebGL2RenderingContext.prototype, "clear");
    const cleanup = plugin.setup?.({ reducedMotion: false } as never, host);
    try {
      const light = source.blueprint.layers.find((l) => (l as CustomLayer).task === THREE_TASKS.light) as CustomLayer;
      const renderer = plugin.renderers?.[THREE_TASKS.light];
      const t = 7_200_000;
      plugin.frame?.(t, 8, false);
      renderer?.mount(light, document.createElement("div"), {} as never);
      renderer?.finish?.(light);
      clear.mockClear();
      // Mid-orbit the camera moves on every tick, also on those nobody sees: only a frame that draws renders.
      plugin.frame?.(t + 3400, 100, false);
      plugin.frame?.(t + 3500, 100, false);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(clear).not.toHaveBeenCalled();
      plugin.frame?.(t + 3600, 100, true);
      expect(clear).toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      if (typeof cleanup === "function") cleanup();
    }
  });
});
