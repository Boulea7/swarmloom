// @vitest-environment node
/**
 * End-to-end render tests: bundle the CLI, run it as a real process against a real browser and ffmpeg,
 * and inspect the result with ffprobe, plus ffmpeg to decode a frame and the sound of the real page's clip.
 * Skipped (with the reason) when the machine lacks Chrome or ffmpeg;
 * the tests on the real render page also skip while its build is missing or older than its inputs.
 * Under CI both fail instead (see ./real-deps), and a wrong SWARMLOOM_CHROME or SWARMLOOM_FFMPEG always does.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { findBrowser } from "../src/discovery/browser";
import { findFfmpeg, systemFfmpegDeps } from "../src/discovery/ffmpeg";
import { systemHost, which } from "../src/discovery/host";
import { findOptional, inCi, renderPageProblem, skipReason } from "./real-deps";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO = path.resolve(CLI_DIR, "../..");
const FIXTURES = path.join(CLI_DIR, "test/fixtures");
const WELCOME = path.join(REPO, "examples/markdown/welcome.en.md");
const EXPORT_RENDER_DIR = path.join(REPO, "packages/export/dist/render");
const TIMEOUT = 240_000;

const host = systemHost();
const chrome = (await findOptional("SWARMLOOM_CHROME", () => findBrowser(host)))?.path;
const ffmpeg = (await findOptional("SWARMLOOM_FFMPEG", () => findFfmpeg(systemFfmpegDeps(host))))?.path;
const ffprobe = ffmpeg ? siblingOrPath(ffmpeg, "ffprobe") : undefined;
const missing = skipReason(
  !chrome
    ? "no Chrome/Chromium found (set SWARMLOOM_CHROME)"
    : !ffmpeg
      ? "no ffmpeg 4+ found (set SWARMLOOM_FFMPEG)"
      : !ffprobe
        ? "no ffprobe next to ffmpeg or on PATH"
        : undefined,
);

const renderPage = renderPageProblem(REPO);

/** Skips a real render page test while the page is unusable; CI must have built it, so there it fails. */
function requireRenderPage(ctx: TestContext): void {
  if (!renderPage) return;
  if (inCi()) throw new Error(`${renderPage} (CI must run pnpm build before pnpm test)`);
  ctx.skip(renderPage);
}

function siblingOrPath(ffmpegPath: string, name: string): string | undefined {
  const ext = path.extname(ffmpegPath);
  const sibling = path.join(path.dirname(ffmpegPath), name + ext);
  return host.isExecutable(sibling) ? sibling : which(host, [name]);
}

let cliPath = "";
let work = "";

beforeAll(async () => {
  if (missing) return;
  // Bundle into the package's node_modules so playwright-core resolves exactly as it does when installed.
  const outDir = path.join(CLI_DIR, "node_modules/.cache/swarmloom-test");
  await mkdir(outDir, { recursive: true });
  cliPath = path.join(outDir, "cli.mjs");
  await build({
    entryPoints: [path.join(CLI_DIR, "src/cli.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    conditions: ["@swarmloom/source"],
    external: ["playwright-core", "ffmpeg-static", "@swarmloom/adapter-*", "@swarmloom/snapshot-dom"],
    logLevel: "error",
  });
  work = await mkdtemp(path.join(outDir, "work-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

interface CliRun {
  child: ChildProcess;
  done: Promise<{ code: number | null; stderr: string }>;
}

function startCli(args: string[], env: Record<string, string>): CliRun {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: work,
    env: { ...process.env, SWARMLOOM_CHROME: chrome ?? "", SWARMLOOM_FFMPEG: ffmpeg ?? "", NO_COLOR: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const done = new Promise<{ code: number | null; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stderr })),
  );
  return { child, done };
}

interface Probe {
  streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>;
  format: { duration: string };
}

function probe(file: string): Promise<Probe> {
  const args = ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration"];
  return new Promise((resolve, reject) =>
    execFile(ffprobe as string, [...args, "-of", "json", file], (error, stdout) =>
      error ? reject(error) : resolve(JSON.parse(stdout) as Probe),
    ),
  );
}

/** Decodes part of `file` with ffmpeg and returns the raw bytes; `args` pick the part and the raw format. */
function decode(file: string, args: string[]): Promise<Buffer> {
  const opts = { encoding: "buffer" as const, maxBuffer: 64 << 20 };
  return new Promise((resolve, reject) =>
    execFile(ffmpeg as string, ["-v", "error", "-i", file, ...args, "-"], opts, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  );
}

async function leftovers(): Promise<string[]> {
  return (await readdir(work)).filter((name) => name.startsWith(".swarmloom-render-"));
}

describe.skipIf(missing)(`render end to end${missing ? ` (skipped: ${missing})` : ""}`, () => {
  it(
    "renders a 2 s clip of examples/markdown/welcome.en.md to MP4 with video and audio",
    async (ctx) => {
      requireRenderPage(ctx);
      const args = ["render", WELCOME, "-o", "welcome.mp4", "--width", "640", "--height", "360"];
      const run = startCli([...args, "--fps", "15", "--max-duration", "2", "--quiet"], {
        SWARMLOOM_RENDER_DIR: EXPORT_RENDER_DIR,
      });
      const { code, stderr } = await run.done;
      // --quiet still warns when the browser runs without its sandbox (on hosts where it cannot start).
      expect(stderr.replace(/^.*runs without one.*\n/m, "")).toBe("");
      expect(code).toBe(0);
      const file = path.join(work, "welcome.mp4");
      const info = await probe(file);
      expect(info.streams).toEqual([
        expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 640, height: 360 }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]);
      expect(Number(info.format.duration)).toBeCloseTo(2, 1);
      // A black or silent file has the same metadata, so decode a frame and the sound and look at them.
      const frameArgs = ["-ss", "1", "-frames:v", "1", "-vf", "scale=64:36", "-pix_fmt", "gray", "-f", "rawvideo"];
      const luma = await decode(file, frameArgs);
      expect(Math.max(...luma) - Math.min(...luma), "luma range of the frame at 1 s").toBeGreaterThan(64);
      const pcm = await decode(file, ["-vn", "-ac", "1", "-f", "s16le"]);
      let peak = 0;
      for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
      expect(peak, "peak sample of the soundtrack").toBeGreaterThan(256);
    },
    TIMEOUT,
  );

  it(
    "goes live after the build: an HTML loop keeps moving through the tail, the same in two runs",
    async (ctx) => {
      requireRenderPage(ctx);
      const take = async (dir: string) => {
        const args = ["render", path.join(FIXTURES, "live/index.html"), "-o", `${dir}/live.mp4`, "--no-sound"];
        const extra = ["--width", "320", "--height", "200", "--fps", "10", "--tail", "3000", "--finale", "none"];
        const run = startCli([...args, ...extra, "--manifest-out", `${dir}/m.json`, "--quiet"], {
          SWARMLOOM_RENDER_DIR: EXPORT_RENDER_DIR,
        });
        const { code, stderr } = await run.done;
        expect(code, stderr).toBe(0);
        return JSON.parse(await readFile(path.join(work, dir, "m.json"), "utf8"));
      };
      const [a, b] = [await take("live-a"), await take("live-b")];
      expect(a.frames.buildFinished).toBe(true);
      // Without go live the last frames of a finished build with no finale are all the same.
      expect(new Set(a.frames.sha256.slice(-5)).size).toBe(5);
      expect(a.frames.aggregateSha256).toBe(b.frames.aggregateSha256);
    },
    TIMEOUT,
  );

  const fakePage = { SWARMLOOM_RENDER_DIR: path.join(FIXTURES, "render") };

  it(
    "drives the render protocol into an MP4 with sound at the device scale",
    async () => {
      // The test double finishes its build after 1 s; --tail 1000 makes the clip exactly 2 s (+1 frame).
      const args = ["render", path.join(FIXTURES, "page/index.html"), "-o", "double.mp4", "--tail", "1000"];
      const run = startCli([...args, "--width", "200", "--height", "120", "--scale", "2", "--fps", "10"], fakePage);
      const { code, stderr } = await run.done;
      expect(code, stderr).toBe(0);
      expect(stderr).toMatch(/Wrote double\.mp4: 2\.1 s, 21 frames, 400x240, with sound/);
      const info = await probe(path.join(work, "double.mp4"));
      expect(info.streams.map((s) => s.codec_type)).toEqual(["video", "audio"]);
      expect(info.streams[0]).toMatchObject({ width: 400, height: 240 });
      expect(await leftovers()).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "writes the same frames, events and manifest for the same arguments (capture evidence)",
    async () => {
      const take = async (dir: string) => {
        const args = ["render", path.join(FIXTURES, "page/index.html"), "-o", `${dir}/take.mp4`, "--duration", "1.5"];
        const extra = ["--fps", "10", "--bpm", "120", "--cue", "2b:pause", "--width", "160", "--height", "90"];
        const outs = [
          "--audio-out",
          `${dir}/take.wav`,
          "--events-out",
          `${dir}/ev.json`,
          "--manifest-out",
          `${dir}/m.json`,
        ];
        const run = startCli([...args, ...extra, ...outs, "--quiet"], fakePage);
        const { code, stderr } = await run.done;
        expect(code, stderr).toBe(0);
        return JSON.parse(await readFile(path.join(work, dir, "m.json"), "utf8"));
      };
      const [a, b] = [await take("a"), await take("b")];
      // Fixed length: 15 frames although the double's build and tail end at 3.5 s.
      expect(a.frames).toMatchObject({ count: 15, imageType: "png", builtAtMs: 1000 });
      expect(a.frames.sha256).toHaveLength(15);
      expect(a.cues).toEqual([{ spec: "2b:pause", atMs: 1000, frame: 10, action: "pause" }]);
      expect(a.player).toMatchObject({ bpm: 120, controls: false });
      expect(a.programs.browser.version).toBeTruthy();
      expect(a.frames.aggregateSha256).toBe(b.frames.aggregateSha256);
      expect(a.sound.soundLogSha256).toBe(b.sound.soundLogSha256);
      const events = JSON.parse(await readFile(path.join(work, "a/ev.json"), "utf8"));
      expect(events.events.map((e: { frame: number }) => e.frame)).toEqual([0, 10]);
      expect(a.outputs.events.sha256).toBe(b.outputs.events.sha256);
      expect(Number((await probe(path.join(work, "a/take.mp4"))).format.duration)).toBeCloseTo(1.5, 1);
      // --audio-out matches the video's 15 frames, not the 1.4 s up to the last frame's start.
      expect(Number((await probe(path.join(work, "a/take.wav"))).format.duration)).toBeCloseTo(1.5, 3);
    },
    TIMEOUT,
  );

  // Windows has no SIGINT delivery to child processes: kill("SIGINT") terminates them outright.
  it.skipIf(process.platform === "win32")(
    "cleans up and exits 130 on Ctrl+C without leaving output",
    async () => {
      const args = ["render", path.join(FIXTURES, "page/index.html"), "-o", "stopped.mp4", "--tail", "60000"];
      const run = startCli([...args, "--width", "200", "--height", "120"], fakePage);
      // Interrupt once frames are flowing (the progress line shows up on stderr).
      for (let i = 0; i < 600 && !(await leftovers()).length; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1500));
      run.child.kill("SIGINT");
      const { code, stderr } = await run.done;
      expect(code, stderr).toBe(130);
      expect(stderr).toContain("Interrupted, cleaning up");
      expect(existsSync(path.join(work, "stopped.mp4"))).toBe(false);
      expect(await leftovers()).toEqual([]);
    },
    TIMEOUT,
  );
});
