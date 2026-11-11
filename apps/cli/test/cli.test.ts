import path from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { parseRenderOptions } from "../src/commands/render";
import { run } from "../src/run";

const cwd = path.resolve("/work");

async function capture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  const code = await run(argv, { io, cwd, env: {} });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("swarmloom entry", () => {
  it.each([
    [["--version"], 0, pkg.version, ""],
    [["--help"], 0, "Usage: swarmloom <command>", ""],
    [[], 1, "", "Usage: swarmloom <command>"],
    [["render", "--help"], 0, "--max-duration", ""],
    [["help", "doctor"], 0, "Usage: swarmloom doctor", ""],
    [["bogus"], 1, "", 'Unknown command "bogus"'],
    [["render"], 1, "", "Missing <file|url>"],
    [["render", "a.md", "--fps", "0"], 1, "", "--fps must be an integer from 1 to 120"],
    [["render", "a.md", "--bogus"], 1, "", "Unknown option --bogus"],
    [["render", "missing.md"], 1, "", "Input not found"],
    [["render", "ftp://example.com/a.md"], 1, "", "Unsupported URL scheme"],
    [["formats", "extra"], 1, "", 'Unexpected argument "extra"'],
  ])("%j exits %i", async (argv, code, out, err) => {
    const result = await capture(argv);
    expect(result.code).toBe(code);
    expect(result.out).toContain(out);
    expect(result.err).toContain(err);
  });

  it("lists formats with the web page row", async () => {
    const result = await capture(["formats"]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Markdown\s+markdown\s+\.md/);
    expect(result.out).toContain("any http(s) URL");
  });
});

describe("render options", () => {
  it("applies defaults and infers the format from --output", () => {
    const opts = parseRenderOptions(["docs/README.md", "-o", "out/clip.webm", "--agents", "12"], cwd);
    expect(opts).toMatchObject({
      output: path.join(cwd, "out/clip.webm"),
      format: "webm",
      width: 1280,
      height: 720,
      scale: 1,
      fps: 30,
      maxDurationMs: 120_000,
      settings: {
        agents: 12,
        speed: 1,
        seed: 1,
        theme: "auto",
        labels: "names",
        finale: "flock",
        tail: 2500,
        live: true,
        sound: true,
      },
    });
    expect(parseRenderOptions(["a.md", "--no-live"], cwd)).toMatchObject({ settings: { live: false } });
  });

  it.each([
    [["README.md"], path.join(cwd, "README.mp4"), "mp4", true],
    [["README.md", "--format", "gif"], path.join(cwd, "README.gif"), "gif", false],
    [
      ["https://example.com/docs/intro.html", "-f", "png-seq"],
      path.join(cwd, "example.com-intro-frames"),
      "png-seq",
      true,
    ],
    [["a.md", "-o", "x.mp4", "--no-sound"], path.join(cwd, "x.mp4"), "mp4", false],
  ])("%j writes %s", (argv, output, format, sound) => {
    const opts = parseRenderOptions(argv, cwd);
    expect(opts).toMatchObject({ output, format, settings: { sound } });
  });

  it.each([
    [["a.md", "-o", "x.mov"], "Cannot tell the video format"],
    [["a.md", "-o", "x.mp4", "--format", "gif"], "--output ends in .mp4 but --format is gif"],
    [["a.md", "--format", "avi"], "--format must be one of"],
    [["a.md", "--speed", "0"], "--speed must be a number at least 0.05"],
    [["a.md", "--speed", "1e3"], "--speed must be a number"],
    [["a.md", "--width", "7680", "--scale", "2"], "larger than 8192 px"],
    [["a.md", "--agents", "many"], "--agents must be an integer"],
    [["a.md", "--locale", "not a tag"], "--locale must be a BCP 47 language tag"],
    [["a.md", "b.md"], 'Unexpected argument "b.md"'],
    [["a.md", "--duration", "5", "--max-duration", "9"], "either --duration (exact length) or --max-duration"],
    [["a.md", "--duration", "4", "--cue", "8b:pause"], "counts beats, which needs --bpm"],
    [["a.md", "--duration", "4", "--bpm", "120", "--cue", "8b:pause"], "at or after the end of the video"],
    [["a.md", "--cue", "3:rewind"], "--cue must look like <time>:<action>"],
    [["a.md", "--no-sound", "--audio-out", "a.wav"], "--audio-out needs sound"],
    [["a.md", "--bpm", "300"], "--bpm must be a number"],
    [["a.md", "-o", "x.mp4", "--manifest-out", "x.mp4"], "must be different files"],
  ])("rejects %j", (argv, message) => {
    expect(() => parseRenderOptions(argv, cwd)).toThrow(message);
  });

  it("resolves a fixed length, beat cues on exact frames and the evidence paths", () => {
    const argv = ["a.svg", "-o", "take.mp4", "--duration", "24", "--bpm", "90", "--cue", "26b:pause"];
    const extra = ["--cue", "18.5:finish", "--cue", "500ms:resume", "--events-out", "ev/e.json"];
    const opts = parseRenderOptions([...argv, ...extra, "--manifest-out", "m.json"], cwd);
    if (opts === "help") throw new Error("unexpected help");
    expect(opts).toMatchObject({ fixedLength: true, maxDurationMs: 24_000, settings: { bpm: 90 } });
    // At 90 bpm and 30 fps a beat is exactly 20 frames, so beat 26 starts frame 520.
    expect(opts.cues.map(({ frame, action }) => [frame, action])).toEqual([
      [520, "pause"],
      [555, "finish"],
      [15, "resume"],
    ]);
    expect(opts.cues[0]?.at).toBeCloseTo(17_333.333, 3);
    expect(opts.eventsOut).toBe(path.join(cwd, "ev/e.json"));
    expect(opts.manifestOut).toBe(path.join(cwd, "m.json"));
  });
});
