import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { networkVerdict } from "../src/browser/network";
import type { FfmpegCaps } from "../src/discovery/ffmpeg";
import { parseEncoders } from "../src/discovery/ffmpeg";
import { InterruptedError } from "../src/errors";
import { planMux, planVideo } from "../src/pipeline/encode";
import { type FrameSource, runFrameLoop } from "../src/pipeline/frames";
import { inputBase, isSiblingAsset, servedInput, toRenderInput } from "../src/pipeline/input";
import { fitFields, Progress, wrapFields } from "../src/pipeline/progress";
import { resolveRequestPath, startStaticServer } from "../src/server/static";
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

  it("captures exactly maxFrames with untilDone false and reports when the build completed", async () => {
    let t = 0;
    const source: FrameSource = {
      async step(ms) {
        t += ms;
        const built = t >= 300 - 1e-6;
        return { state: built ? "finale" : "building", built: built ? 1 : 0, total: 1, done: t >= 400 - 1e-6 };
      },
      capture: async () => new Uint8Array([0]),
    };
    const result = await runFrameLoop(source, async () => {}, { fps: 10, maxFrames: 12, untilDone: false });
    expect(result).toMatchObject({ frames: 12, finished: true, builtAtMs: 300, durationMs: 1200 });
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

describe("progress line", () => {
  it("drops the fields that do not fit instead of cutting a word", () => {
    const fields = [`rendering ${"█".repeat(2)}${"░".repeat(22)}   7%`, "frame 12", "0:41 left"];
    expect(fitFields(fields, 80)).toBe(`${fields[0]}  frame 12  0:41 left`);
    expect(fitFields(fields, 42)).toBe(fields[0]);
    expect(fitFields(fields, 49)).toBe(`${fields[0]}  frame 12`);
    expect(fitFields(["encoding the video"], 8)).toBe("encoding");
  });

  it("keeps the percent and time left on a narrow terminal and never wraps", () => {
    const draw = (columns: number) => {
      let line = "";
      const tty = { columns, write: (chunk: string) => (line = chunk.replace("\r\u001b[2K", "")) };
      new Progress({ out() {}, err() {}, tty }, 1, false).update({ frame: 11, built: 1, total: 1, done: false });
      expect(line.length).toBeLessThan(columns);
      return line.replace(/\d+:\d\d left/, "T left");
    };
    expect(draw(80)).toBe(`rendering ${"█".repeat(22)}░░  92%  T left  frame 12  layers 1/1`);
    expect(draw(30)).toBe("rendering  92%  T left");
    expect(draw(36)).toBe(`rendering ${"█".repeat(8)}░  92%  T left`);
    expect(draw(10)).toBe("92%");
  });

  it("breaks the start banner between fields on a narrow terminal", () => {
    const banner = ["Rendering landing.html (html)", "at 1920x1080, 30 fps", "-> take.mp4"];
    expect(wrapFields(banner, Number.POSITIVE_INFINITY)).toEqual([banner.join(" ")]);
    expect(wrapFields(banner, 41)).toEqual([banner[0], "  at 1920x1080, 30 fps -> take.mp4"]);
    expect(wrapFields(banner, 20)).toEqual([banner[0], "  at 1920x1080, 30 fps", "  -> take.mp4"]);
  });
});

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
  const base = inputBase("tok");
  const inputUrl = `http://127.0.0.1:4000${base}`;

  it("inlines text, with the published input as base URL only for local files", () => {
    const md = { kind: "file" as const, name: "a b.md", format: "markdown", content: { text: "# Hi" } };
    expect(toRenderInput(md, inputUrl)).toEqual({ name: "a b.md", type: "markdown", text: "# Hi" });
    const local = { ...md, dir: "/docs" };
    expect(toRenderInput(local, inputUrl).url).toBe("http://127.0.0.1:4000/input/tok/a%20b.md");
    const served = servedInput(local, base);
    expect(served.files.size).toBe(0);
    expect(served.mounts).toEqual([expect.objectContaining({ prefix: "/input/tok/", dir: "/docs" })]);
    expect(["/docs/shot.PNG", "/docs/notes.md", "/docs/run.js"].map(served.mounts[0]?.accept ?? (() => 0))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("serves binaries from the page origin instead of passing them as base64", () => {
    const deck = {
      kind: "file" as const,
      name: "my deck.pptx",
      format: "slides",
      content: { path: "/in/my deck.pptx" },
    };
    expect(toRenderInput(deck, inputUrl)).toEqual({
      name: "my deck.pptx",
      type: "slides",
      url: "http://127.0.0.1:4000/input/tok/my%20deck.pptx",
    });
    expect([...servedInput(deck, base).files]).toEqual([["/input/tok/my%20deck.pptx", "/in/my deck.pptx"]]);
  });
});

describe("network policy", () => {
  const policy = { localOrigin: "http://127.0.0.1:4000", remoteAssets: true };
  it.each([
    ["http://127.0.0.1:4000/chunks/adapter-pdf.js", "script", policy, "allow"],
    ["data:image/png;base64,AAAA", "image", policy, "allow"],
    ["https://cdn.example/logo.png", "image", policy, "anonymous"],
    ["https://fonts.example/a.woff2", "font", policy, "anonymous"],
    ["https://cdn.example/app.js", "script", policy, "block"],
    ["https://cdn.example/site.css", "stylesheet", policy, "block"],
    ["https://api.example/data", "fetch", policy, "block"],
    ["http://cdn.example/logo.png", "image", policy, "block"],
    ["http://127.0.0.1:4001/x.png", "image", policy, "block"],
    ["https://cdn.example/logo.png", "image", { ...policy, remoteAssets: false }, "block"],
  ] as const)("%s (%s)", (url, type, p, verdict) => {
    expect(networkVerdict(url, type, p)).toBe(verdict);
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

describe("static server input mount", () => {
  // node:http rather than fetch: the unit project's DOM environment replaces fetch.
  const status = (url: URL) =>
    new Promise<number | undefined>((resolve, reject) =>
      get(url, (res) => resolve(res.resume().statusCode)).on("error", reject),
    );

  it("publishes only sibling assets, never documents, scripts or dotfiles", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "swarmloom-mount-"));
    await mkdir(path.join(dir, "img"));
    for (const name of ["img/shot.png", "notes.md", ".hidden.png", "index.html"]) {
      await writeFile(path.join(dir, name), "x");
    }
    const server = await startStaticServer({
      root: dir,
      mounts: [{ prefix: "/input/tok/", dir, accept: isSiblingAsset }],
    });
    try {
      expect(
        await Promise.all(
          [
            "/input/tok/img/shot.png",
            "/input/tok/notes.md",
            "/input/tok/.hidden.png",
            "/input/tok/",
            "/input/x/img/shot.png",
          ].map((p) => status(new URL(p, server.url))),
        ),
      ).toEqual([200, 404, 404, 404, 404]);
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves a symlink only when its target is a published file inside the folder", async () => {
    const top = await mkdtemp(path.join(tmpdir(), "swarmloom-link-"));
    const dir = path.join(top, "site");
    await mkdir(dir);
    await writeFile(path.join(top, "secret.txt"), "TOP-SECRET");
    await writeFile(path.join(dir, "notes.md"), "x");
    await writeFile(path.join(dir, "shot.png"), "x");
    for (const [name, target] of [
      ["leak.png", path.join(top, "secret.txt")],
      ["alias.png", "notes.md"],
      ["link.png", "shot.png"],
    ]) {
      await symlink(target, path.join(dir, name));
    }
    const server = await startStaticServer({
      root: dir,
      mounts: [{ prefix: "/input/tok/", dir, accept: isSiblingAsset }],
    });
    try {
      expect(
        await Promise.all(
          ["/input/tok/leak.png", "/input/tok/alias.png", "/input/tok/link.png", "/leak.png", "/link.png"].map((p) =>
            status(new URL(p, server.url)),
          ),
        ),
      ).toEqual([404, 404, 200, 404, 200]);
    } finally {
      await server.close();
      await rm(top, { recursive: true, force: true });
    }
  });
});
