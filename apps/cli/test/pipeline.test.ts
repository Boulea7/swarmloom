import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FfmpegCaps } from "../src/discovery/ffmpeg";
import { parseEncoders } from "../src/discovery/ffmpeg";
import { InterruptedError } from "../src/errors";
import { planMux, planVideo } from "../src/pipeline/encode";
import { type FrameSource, runFrameLoop } from "../src/pipeline/frames";
import { servedInput, toRenderInput } from "../src/pipeline/input";
import { resolveRequestPath } from "../src/server/static";
import { guard } from "../src/util/async";

/** A page whose build is done once `doneAt` engine ms have elapsed. */
function fakeSource(doneAt: number): FrameSource & { steps: number[] } {
  let t = 0;
  const steps: number[] = [];
  return {
    steps,
    async step(ms) {
      steps.push(ms);
      t += ms;
      return { state: "building", built: 0, total: 1, done: t >= doneAt - 1e-6 };
    },
    capture: async () => new Uint8Array([t & 0xff]),
  };
}

describe("frame loop", () => {
  it("captures frame 0 at t=0 and includes the frame where the page reports done", async () => {
    const source = fakeSource(1000);
    const sunk: number[] = [];
    const result = await runFrameLoop(source, async (_f, i) => void sunk.push(i), { fps: 30, maxFrames: 1000 });
    expect(result).toMatchObject({ frames: 31, finished: true, durationMs: (31 * 1000) / 30 });
    expect(sunk).toEqual([...Array(31).keys()]);
    // Steps are differences of exact frame times, so they sum to the elapsed time without drift.
    expect(source.steps.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 9);
  });

  it("stops at maxFrames before done", async () => {
    const result = await runFrameLoop(fakeSource(10_000), async () => {}, { fps: 10, maxFrames: 20 });
    expect(result).toMatchObject({ frames: 20, finished: false, durationMs: 2000 });
  });

  it("throws InterruptedError once aborted", async () => {
    const controller = new AbortController();
    const sink = async (_f: Uint8Array, i: number) => {
      if (i === 2) controller.abort();
    };
    const loop = runFrameLoop(fakeSource(10_000), sink, { fps: 10, maxFrames: 100, signal: controller.signal });
    await expect(loop).rejects.toBeInstanceOf(InterruptedError);
  });
});

const FULL: FfmpegCaps = {
  encoders: new Set(["libx264", "libvpx-vp9", "libopus", "aac", "libwebp_anim", "ffv1"]),
  filters: new Set(["palettegen", "paletteuse"]),
};

describe("guard", () => {
  it("observes the guarded promise when it gives up early (regression: crash on early Ctrl+C)", async () => {
    const controller = new AbortController();
    controller.abort();
    let rejectLate: (error: Error) => void = () => {};
    const pending = new Promise<never>((_resolve, reject) => {
      rejectLate = reject;
    });
    await expect(guard(pending, "Opening the page", 1000, controller.signal)).rejects.toBeInstanceOf(InterruptedError);
    // Cleanup closes the browser afterwards, which rejects the abandoned call; that must stay handled.
    rejectLate(new Error("page.goto: net::ERR_ABORTED"));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("times out with a RenderError", async () => {
    await expect(guard(new Promise(() => {}), "A render step", 5)).rejects.toThrow("A render step timed out");
  });
});

describe("encoder plans", () => {
  it("pipes JPEG frames into H.264 yuv420p with faststart for mp4", () => {
    const plan = planVideo("mp4", 30, "/tmp/x", FULL);
    const args = plan.stream.join(" ");
    expect(args).toContain("-f image2pipe -framerate 30 -c:v mjpeg -i pipe:0");
    expect(args).toContain("format=yuv420p");
    expect(args).toContain("-c:v libx264");
    expect(args).toContain("-movflags +faststart");
    expect(plan.output).toBe(path.join("/tmp/x", "video.mp4"));
  });

  it("builds gif in a lossless pass then palettegen and paletteuse", () => {
    const plan = planVideo("gif", 15, "/tmp/x", FULL);
    expect(plan.stream).toContain("ffv1");
    expect(plan.passes.map((p) => p.join(" "))).toEqual([
      expect.stringContaining("palettegen"),
      expect.stringContaining("paletteuse"),
    ]);
  });

  it("pads audio and cuts the mux at the explicit video duration", () => {
    const args = planMux("webm", { video: "v.webm", wav: "a.wav", output: "o.webm", durationMs: 2100 }, FULL);
    expect(args).toEqual(expect.arrayContaining(["-c:v", "copy", "-c:a", "libopus", "apad", "-t", "2.100000"]));
    expect(args).not.toContain("-shortest");
  });

  it("reports a missing encoder as a missing dependency", () => {
    const caps = { encoders: new Set(["aac"]), filters: new Set<string>() };
    expect(() => planVideo("mp4", 30, "/tmp", caps)).toThrow("no libx264 encoder");
  });

  it("parses `ffmpeg -encoders` output", () => {
    const text = "Encoders:\n V..... = Video\n ------\n V....D libx264    H.264\n A....D aac        AAC\n";
    expect([...parseEncoders(text)]).toEqual(["libx264", "aac"]);
  });
});

describe("render input", () => {
  const origin = "http://127.0.0.1:4000";
  it("inlines text and serves files and downloads from the page origin", () => {
    const md = { kind: "file" as const, name: "a.md", format: "markdown", content: { text: "# Hi" } };
    expect(toRenderInput(md, origin)).toEqual({ name: "a.md", type: "markdown", text: "# Hi" });
    expect(servedInput(md).size).toBe(0);

    const deck = {
      kind: "file" as const,
      name: "my deck.pptx",
      format: "slides",
      content: { path: "/in/my deck.pptx" },
    };
    expect(toRenderInput(deck, origin)).toEqual({
      name: "my deck.pptx",
      type: "slides",
      url: "http://127.0.0.1:4000/input/my%20deck.pptx",
    });
    expect([...servedInput(deck)]).toEqual([["/input/my%20deck.pptx", "/in/my deck.pptx"]]);
  });
});

describe("static server paths", () => {
  const root = path.resolve("/srv/studio");
  it.each([
    ["/app/index.html", path.join(root, "index.html")],
    ["/app/a%20b.js", path.join(root, "a b.js")],
    ["/app/../secret", null],
    ["/app/..%2f..%2fetc%2fpasswd", null],
    ["/app/%E0%A4%A", null],
    ["/other/index.html", null],
  ])("%s", (urlPath, expected) => {
    expect(resolveRequestPath(root, "/app/", urlPath)).toBe(expected);
  });
});
