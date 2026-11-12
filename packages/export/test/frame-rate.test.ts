import type { Blueprint, SoundEvent } from "@swarmloom/core";
import { describe, expect, it } from "vitest";
import { exportFrames } from "../src/index";

const blueprint: Blueprint = {
  version: 1,
  source: { type: "test" },
  size: { w: 400, h: 400 },
  background: "#fff",
  layers: Array.from({ length: 8 }, (_, i) => ({
    id: `line${i}`,
    kind: "text" as const,
    box: { x: 10, y: 10 + i * 40, w: 300, h: 20 },
    html: "Woven line",
    text: "Woven line",
    style: {},
  })),
};

/** A real build to the end; its sound log (times and pans) fingerprints what the cursors did. */
async function build(fps: number): Promise<{ soundLog: readonly SoundEvent[] }> {
  const host = document.body.appendChild(document.createElement("div"));
  try {
    return await exportFrames({ blueprint, host, seed: 7, sound: false }, { fps, onFrame: () => undefined });
  } finally {
    host.remove();
  }
}

describe("export frame rate", () => {
  it("samples one build whatever the frame rate (15, 24, 30 and 60 fps divide the engine's 120 ticks)", async () => {
    const at30 = await build(30);
    expect(at30.soundLog.length).toBeGreaterThan(8);
    for (const fps of [15, 24, 60]) expect((await build(fps)).soundLog).toEqual(at30.soundLog);
  });
});
