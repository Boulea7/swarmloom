import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import type { Blueprint } from "@swarmloom/core";
import type { Browser, Page } from "playwright-core";
import { type ContextOptions, launchBrowser, newContext, watchPage } from "../browser/launch";
import { snapshotPage } from "../browser/snapshot";
import type { FfmpegCaps } from "../discovery/ffmpeg";
import { RenderError, throwIfAborted } from "../errors";
import { type CliIo, warn } from "../io";
import { startStaticServer } from "../server/static";
import { Cleanup } from "../util/async";
import { moveIntoPlace } from "../util/fs";
import { trackTempDir } from "../util/owned";
import { RenderPageDriver } from "./driver";
import { formatHasAudio, frameImageType, type OutputFormat } from "./encode";
import { runFrameLoop } from "./frames";
import { type RenderSource, servedInput, toRenderInput } from "./input";
import { type FrameWriter, ffmpegWriter, pngSequenceWriter } from "./output";
import { formatClock, Progress } from "./progress";
import type { RenderInit, StepResult } from "./protocol";

const SNAPSHOT_TIMEOUT_MS = 60_000;

/** Player settings forwarded verbatim to the render page. */
export type PlayerSettings = Omit<RenderInit, "input" | "width" | "height" | "fps" | "blueprint">;

export interface RenderJob {
  source: RenderSource;
  /** Absolute output path: a file, or a directory for png-seq. */
  output: string;
  format: OutputFormat;
  width: number;
  height: number;
  scale: number;
  fps: number;
  settings: PlayerSettings;
  maxDurationMs: number;
  quiet: boolean;
  verbose: boolean;
}

export interface RenderDeps {
  io: CliIo;
  signal?: AbortSignal;
  browserPath: string;
  /** Required for every format except png-seq. */
  ffmpeg?: { path: string; caps: FfmpegCaps };
  /** Directory with the render page's index.html. */
  renderDir: string;
  /** dist/snapshot.js, used to capture web pages live. */
  snapshotBundle?: string;
  /** Parent of the temporary work directory. Default: the output's directory (same file system). */
  tmpRoot?: string;
}

export interface RenderSummary {
  frames: number;
  durationMs: number;
  /** False when --max-duration cut the build short. */
  finished: boolean;
  audio: boolean;
  last: StepResult;
}

/**
 * Renders a source to a video: serves the render page, loads the input on a virtual clock, captures
 * one CDP screenshot per frame into ffmpeg (or PNG files), then muxes the offline-rendered soundtrack.
 * Output appears only when everything succeeded; temporary files, the browser and ffmpeg are always
 * cleaned up, including on abort.
 *
 * @throws CliError subclasses: MissingDependencyError, RenderError, InterruptedError.
 */
export async function renderVideo(job: RenderJob, deps: RenderDeps): Promise<RenderSummary> {
  const { io, signal } = deps;
  const cleanup = new Cleanup((message) => warn(io, `cleanup: ${message}`));
  const progress = new Progress(io, 1, job.quiet);
  try {
    throwIfAborted(signal);
    const tmpRoot = deps.tmpRoot ?? path.dirname(job.output);
    await mkdir(tmpRoot, { recursive: true });
    const tmp = await mkdtemp(path.join(tmpRoot, ".swarmloom-render-"));
    cleanup.defer(trackTempDir(tmp));

    const server = await startStaticServer({ root: deps.renderDir, files: servedInput(job.source) });
    cleanup.defer(() => server.close());
    const browser = await launchBrowser(deps.browserPath);
    cleanup.defer(() => browser.close());
    const viewport: ContextOptions = {
      width: job.width,
      height: job.height,
      scale: job.scale,
      colorScheme: job.settings.theme === "dark" ? "dark" : "light",
      locale: job.settings.locale ?? "en-US",
    };

    const blueprint = await captureLivePage(browser, viewport, job, deps);
    const driver = await RenderPageDriver.open(await newContext(browser, viewport), {
      url: `${server.url}index.html`,
      width: job.width,
      height: job.height,
      scale: job.scale,
      imageType: frameImageType(job.format),
      io,
      verbose: job.verbose,
      signal,
    });
    const estimate =
      (await driver.init({
        input: toRenderInput(job.source, new URL(server.url).origin),
        width: job.width,
        height: job.height,
        fps: job.fps,
        ...job.settings,
        ...(blueprint ? { blueprint } : {}),
      })) || job.maxDurationMs;
    if (estimate > job.maxDurationMs) {
      const need = formatClock(estimate / 1000);
      const max = formatClock(job.maxDurationMs / 1000);
      warn(io, `the build needs about ${need} but --max-duration is ${max}; the video will stop early`);
    }

    const writer = await createWriter(job, deps, tmp);
    cleanup.defer(() => writer.abort());
    const maxFrames = Math.max(1, Math.round((job.maxDurationMs * job.fps) / 1000));
    progress.expect(Math.min(maxFrames, Math.ceil((estimate * job.fps) / 1000) + 1));
    const result = await runFrameLoop(driver, (frame, index) => writer.write(frame, index), {
      fps: job.fps,
      maxFrames,
      signal,
      onFrame: (frame, step) => progress.update({ frame, ...step }),
    });

    progress.phase("encoding");
    let output = await writer.finish();
    let audio = false;
    if (job.settings.sound && formatHasAudio(job.format)) {
      progress.phase("rendering sound");
      const wav = await driver.audioWav();
      if (wav) {
        progress.phase("adding sound");
        output = await writer.addAudio(output, wav, result.durationMs);
        audio = true;
      }
    }
    await driver.dispose();
    progress.clear();
    await moveIntoPlace(output, job.output);
    return {
      frames: result.frames,
      durationMs: result.durationMs,
      finished: result.finished,
      audio,
      last: result.last,
    };
  } finally {
    progress.clear();
    await cleanup.run();
  }
}

/** For http(s) pages: a blueprint captured from the live page, or undefined to use its static HTML. */
async function captureLivePage(
  browser: Browser,
  viewport: ContextOptions,
  job: RenderJob,
  deps: RenderDeps,
): Promise<Blueprint | undefined> {
  if (job.source.kind !== "page") return undefined;
  if (!deps.snapshotBundle) {
    warn(deps.io, "the page snapshot script is not bundled; rendering the page's static HTML instead");
    return undefined;
  }
  const context = await newContext(browser, { ...viewport, bypassCSP: true });
  try {
    const bundle = await readFile(deps.snapshotBundle, "utf8");
    const watch = (page: Page) => watchPage(page, deps.io, job.verbose);
    const opts = { url: job.source.url, bundle, timeoutMs: SNAPSHOT_TIMEOUT_MS, signal: deps.signal, watch };
    return (await snapshotPage(context, opts)).blueprint;
  } finally {
    await context.close().catch(() => {});
  }
}

function createWriter(job: RenderJob, deps: RenderDeps, tmp: string): Promise<FrameWriter> {
  if (job.format === "png-seq") return pngSequenceWriter(tmp);
  if (!deps.ffmpeg) throw new RenderError("ffmpeg is required for this format");
  const { path: ffmpegPath, caps } = deps.ffmpeg;
  return Promise.resolve(ffmpegWriter(job.format, { ffmpegPath, caps, fps: job.fps, tmp, signal: deps.signal }));
}
