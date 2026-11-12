import type { CustomLayer, StageApi } from "@swarmloom/core";
import { expect, it } from "vitest";
import shuttle from "../../../examples/svg/shuttle.svg?raw";
import { SMIL_TASK, svgAdapter } from "../src/index";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Runs in Firefox too: it ignores pauseAnimations() on a detached <svg>, so the pause at mount
// alone left the inserted drawing on wall-clock time between frames and exports differed per run.
it("holds the SMIL timeline on player time between frames once the drawing is in the page", async () => {
  const { blueprint, plugins } = await svgAdapter.load({ text: shuttle }, { document, width: 640, theme: "light" });
  const smil = blueprint.layers.find((l) => l.kind === "custom" && l.task === SMIL_TASK) as CustomLayer;
  const plugin = plugins?.[0];
  const renderer = plugin?.renderers?.[SMIL_TASK];
  const world = document.createElement("div");
  document.body.append(world);
  const container = document.createElement("div");
  world.attachShadow({ mode: "open" }).append(container);
  const wrapper = renderer?.mount(smil, container, { blueprint } as StageApi) as HTMLElement;
  container.append(wrapper);
  const svg = wrapper.shadowRoot?.querySelector("svg") as SVGSVGElement;
  try {
    plugin?.frame?.(0, 16);
    await wait(60);
    expect(svg.getCurrentTime()).toBe(0);
    renderer?.finish?.(smil);
    plugin?.frame?.(1000, 16);
    plugin?.frame?.(1100, 16);
    await wait(60);
    expect(svg.animationsPaused()).toBe(true);
    expect(svg.getCurrentTime()).toBeCloseTo(0.1, 3);
  } finally {
    renderer?.unmount?.(smil);
    world.remove();
  }
});
