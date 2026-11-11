// @vitest-environment node
/**
 * End-to-end render tests: bundle the CLI, run it as a real process against a real browser and ffmpeg,
 * and inspect the result with ffprobe. Skipped (with the reason) when the machine lacks Chrome or ffmpeg;
 * the tests on the real render page also skip while its build is missing or older than the sources.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findBrowser } from "../src/discovery/browser";
import { findFfmpeg, systemFfmpegDeps } from "../src/discovery/ffmpeg";
import { systemHost, which } from "../src/discovery/host";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO = path.resolve(CLI_DIR, "../..");
const FIXTURES = path.join(CLI_DIR, "test/fixtures");
const WELCOME = path.join(REPO, "examples/markdown/welcome.en.md");
const EXPORT_RENDER_DIR = path.join(REPO, "packages/export/dist/render");
const TIMEOUT = 240_000;

const host = systemHost();
const chrome = (() => {
  try {
    return findBrowser(host).path;
  } catch {
    return undefined;
  }
})();
const ffmpeg = await findFfmpeg(systemFfmpegDeps(host)).then(
  (found) => found.path,
  () => undefined,
);
const ffprobe = ffmpeg ? siblingOrPath(ffmpeg, "ffprobe") : undefined;
const missing = !chrome
  ? "no Chrome/Chromium found (set SWARMLOOM_CHROME)"
  : !ffmpeg
    ? "no ffmpeg 4+ found (set SWARMLOOM_FFMPEG)"
    : !ffprobe
      ? "no ffprobe next to ffmpeg or on PATH"
      : undefined;

/**
 * Why the real render page cannot be used: it is not built, or a file under packages/<name>/src changed
 * after the build. The page bundles every package from src/, so a stale build would test old code.
 */
function renderPageProblem(): string | undefined {
  const page = path.join(EXPORT_RENDER_DIR, "index.html");
  const rebuild = "run pnpm -F @swarmloom/export build";
  if (!existsSync(page)) return `render page not built yet: ${rebuild}`;
  const builtAt = statSync(page).mtimeMs;
  const packages = path.join(REPO, "packages");
  for (const name of readdirSync(packages)) {
    const src = path.join(packages, name, "src");
    if (!existsSync(src)) continue;
    const files = readdirSync(src, { recursive: true, encoding: "utf8" });
    if (files.some((file) => statSync(path.join(src, file)).mtimeMs > builtAt)) {
      return `render page is older than packages/${name}/src: ${rebuild}`;
    }
  }
  return undefined;
}

const renderPage = renderPageProblem();

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

async function leftovers(): Promise<string[]> {
  return (await readdir(work)).filter((name) => name.startsWith(".swarmloom-render-"));
}

describe.skipIf(missing)(`render end to end${missing ? ` (skipped: ${missing})` : ""}`, () => {
  it(
    "renders a 2 s clip of examples/markdown/welcome.en.md to MP4 with video and audio",
    async (ctx) => {
      if (renderPage) ctx.skip(renderPage);
      if (!existsSync(WELCOME)) ctx.skip("examples/markdown/welcome.en.md is not in this checkout yet");
      const args = ["render", WELCOME, "-o", "welcome.mp4", "--width", "640", "--height", "360"];
      const run = startCli([...args, "--fps", "15", "--max-duration", "2", "--quiet"], {
        SWARMLOOM_RENDER_DIR: EXPORT_RENDER_DIR,
      });
      const { code, stderr } = await run.done;
      expect(stderr).toBe("");
      expect(code).toBe(0);
      const info = await probe(path.join(work, "welcome.mp4"));
      expect(info.streams).toEqual([
        expect.objectContaining({ codec_type: "video", codec_name: "h264", width: 640, height: 360 }),
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
      ]);
      expect(Number(info.format.duration)).toBeCloseTo(2, 1);
    },
    TIMEOUT,
  );

  it(
    "goes live after the build: an HTML loop keeps moving through the tail, the same in two runs",
    async (ctx) => {
      if (renderPage) ctx.skip(renderPage);
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
