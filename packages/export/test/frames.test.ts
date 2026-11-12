import type { PlayerOptions } from "@swarmloom/core";
import { describe, expect, it, vi } from "vitest";
import { exportFrames } from "../src/index";
import { ClockPlayer } from "./fake-player";

const created: ClockPlayer[] = [];

vi.mock("@swarmloom/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@swarmloom/core")>()),
  createPlayer: (options: PlayerOptions) => {
    const player = new ClockPlayer(options, 100);
    created.push(player);
    return player;
  },
}));

const blueprint = {
  version: 1 as const,
  source: { type: "fake" },
  size: { w: 10, h: 10 },
  background: "#fff",
  layers: [],
};

describe("exportFrames", () => {
  it("captures exact frame times until the build and tail are done", async () => {
    const times: number[] = [];
    const result = await exportFrames({ blueprint }, { fps: 30, tailMs: 50, onFrame: (_i, t) => void times.push(t) });
    // Built at frame 3 (100 ms), done once 50 ms more have passed (frame 5 = 166.7 ms).
    expect(result.frames).toBe(6);
    expect(times.map(Math.round)).toEqual([0, 33, 67, 100, 133, 167]);
    expect(result.durationMs).toBe(200);
    expect(result.soundLog).toHaveLength(4);
    expect(created[0]?.options.controls).toBe(false);
    expect(created[0]?.destroyed).toBe(true);
  });

  it("keeps exporting through recoverable player errors and reports them as warnings", async () => {
    const warning = new Error("blueprint: 1 reference(s) to missing layers ignored");
    const seen: Error[] = [];
    const emitWarning = (index: number) => {
      if (index === 0) created.at(-1)?.emit({ type: "error", error: warning });
    };
    const result = await exportFrames(
      { blueprint },
      { fps: 30, onFrame: emitWarning, onWarning: (error) => void seen.push(error) },
    );
    expect(result.frames).toBe(4);
    expect(result.warnings).toEqual([warning]);
    expect(seen).toEqual([warning]);
    // A throwing onWarning makes the warning fatal.
    const strict = exportFrames(
      { blueprint },
      {
        fps: 30,
        onFrame: emitWarning,
        onWarning: (error) => {
          throw error;
        },
      },
    );
    await expect(strict).rejects.toBe(warning);
  });

  it("stops at maxDurationMs and rejects bad options", async () => {
    const result = await exportFrames({ blueprint }, { fps: 10, maxDurationMs: 50, onFrame: () => undefined });
    expect(result.frames).toBe(1);
    // The one frame stays up for 100 ms, the whole build: the sound log holds its four keys.
    expect(result.soundLog).toHaveLength(4);
    await expect(exportFrames({ blueprint }, { fps: 0, onFrame: () => undefined })).rejects.toThrow(RangeError);
  });
});
