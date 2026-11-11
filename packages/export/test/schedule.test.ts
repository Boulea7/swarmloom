import { describe, expect, it } from "vitest";
import { type CodecProbe, planEncoding, UnsupportedExportError } from "../src/browser/encode";
import { type FrameDriver, type FrameProgress, frameTime, runFrameSchedule } from "../src/browser/schedule";
import type { RenderStep } from "../src/render/protocol";

/** A render page whose build ends after `builtAfter` steps and whose tail ends after `doneAfter`. */
function fakePage(builtAfter: number, doneAfter = Number.POSITIVE_INFINITY, layers = 10) {
  const steps: number[] = [];
  const captures: [number, number][] = [];
  let clock = 0;
  const driver: FrameDriver = {
    async step(ms) {
      steps.push(ms);
      const n = steps.length;
      const built = n >= builtAfter;
      return {
        state: built ? "finale" : "building",
        built: Math.min(layers, Math.round((layers * n) / builtAfter)),
        total: layers,
        done: n >= doneAfter,
      } satisfies RenderStep;
    },
    async capture(index, timeMs) {
      captures.push([index, timeMs]);
      clock += 100;
    },
  };
  return { driver, steps, captures, now: () => clock };
}

const noYield = async () => undefined;

describe("frame schedule", () => {
  it("captures frame 0, then steps by whole frames until the page is done", async () => {
    const page = fakePage(5, 8);
    const result = await runFrameSchedule(page.driver, {
      fps: 30,
      maxFrames: 100,
      estimatedFrames: 9,
      tailMs: 100,
      yieldToUi: noYield,
    });
    expect(result).toMatchObject({ frames: 9, finished: true, builtAtMs: frameTime(5, 30) });
    expect(result.durationMs).toBeCloseTo(300);
    expect(page.captures.map(([index]) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(page.captures.map(([, t]) => t)).toEqual(page.captures.map(([n]) => frameTime(n, 30)));
    // Steps are differences of exact frame times, so they add up without drift.
    expect(page.steps.reduce((a, b) => a + b, 0)).toBeCloseTo(frameTime(8, 30), 9);
  });

  it("reports progress, an ETA after a few frames, and a total that follows the build", async () => {
    // Estimated 6 frames, but the build needs 12 steps; the tail adds 3 frames.
    const page = fakePage(12, 15);
    const progress: FrameProgress[] = [];
    await runFrameSchedule(page.driver, {
      fps: 30,
      maxFrames: 100,
      estimatedFrames: 6,
      tailMs: 100,
      now: page.now,
      yieldToUi: noYield,
      onProgress: (p) => progress.push(p),
    });
    expect(progress.map((p) => p.etaMs === null)).toEqual([true, true, true, true, ...Array(12).fill(false)]);
    expect(progress[1]).toMatchObject({ frames: 2, totalFrames: 6 });
    // Past the estimate: frames so far scaled by layers built (8 of 10 after 9 steps), plus the tail.
    expect(progress[9]).toMatchObject({ frames: 10, built: 8, layers: 10, totalFrames: 17 });
    // Built at frame 12: 12 + 3 tail frames + the frame that reports done.
    expect(progress[12]?.totalFrames).toBe(16);
    expect(progress[4]?.etaMs).toBe(100 * (progress[4]?.totalFrames ?? 0) - 500);
    expect(progress.at(-1)).toMatchObject({ frames: 16, totalFrames: 16, etaMs: 0 });
  });

  it("stops at maxFrames when the build never ends", async () => {
    const page = fakePage(Number.POSITIVE_INFINITY);
    const result = await runFrameSchedule(page.driver, {
      fps: 60,
      maxFrames: 4,
      estimatedFrames: 2,
      tailMs: 0,
      yieldToUi: noYield,
    });
    expect(result).toMatchObject({ frames: 4, finished: false, builtAtMs: null });
  });

  it("stops between frames when cancelled", async () => {
    const page = fakePage(50);
    const controller = new AbortController();
    const capture = page.driver.capture;
    page.driver.capture = async (index, timeMs) => {
      await capture(index, timeMs);
      if (index === 2) controller.abort(new Error("cancelled"));
    };
    await expect(
      runFrameSchedule(page.driver, {
        fps: 30,
        maxFrames: 100,
        estimatedFrames: 60,
        tailMs: 0,
        signal: controller.signal,
        yieldToUi: noYield,
      }),
    ).rejects.toThrow("cancelled");
    expect(page.captures).toHaveLength(3);
    expect(page.steps).toHaveLength(2);
  });
});

describe("encoding plan", () => {
  const probe = (video: string[], audio: string[]): CodecProbe => ({
    video: async (codec) => video.includes(codec),
    audio: async (codec) => audio.includes(codec),
  });

  it.each([
    [["avc", "vp9"], ["aac", "opus"], true, { container: "mp4", video: "avc", audio: "aac", mimeType: "video/mp4" }],
    [["avc"], ["opus"], true, { container: "mp4", video: "avc", audio: "opus" }],
    [["vp9"], ["aac", "opus"], true, { container: "webm", video: "vp9", audio: "opus", mimeType: "video/webm" }],
    [["vp9"], ["aac"], true, { container: "webm", audio: null }],
    [["avc"], ["aac"], false, { container: "mp4", audio: null }],
  ])("video %j, audio %j, sound %s", async (video, audio, sound, plan) => {
    expect(await planEncoding(1280, 720, 30, sound, probe(video, audio))).toMatchObject(plan);
  });

  it("refuses when neither H.264 nor VP9 can be encoded", async () => {
    await expect(planEncoding(1920, 1080, 60, true, probe([], ["opus"]))).rejects.toBeInstanceOf(
      UnsupportedExportError,
    );
  });
});
