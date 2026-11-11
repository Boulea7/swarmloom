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
        sound: true,
      },
    });
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

  it("forwards --bpm and resolves --events-out", () => {
    const opts = parseRenderOptions(["a.pdf", "-f", "png-seq", "--bpm", "121.991", "--events-out", "o/ev.json"], cwd);
    expect(opts).toMatchObject({ eventsOut: path.join(cwd, "o/ev.json"), settings: { bpm: 121.991 } });
    expect(parseRenderOptions(["a.pdf"], cwd)).not.toHaveProperty("eventsOut");
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
    [["a.md", "--bpm", "300"], "--bpm must be a number"],
    [["a.md", "b.md"], 'Unexpected argument "b.md"'],
  ])("rejects %j", (argv, message) => {
    expect(() => parseRenderOptions(argv, cwd)).toThrow(message);
  });
});
