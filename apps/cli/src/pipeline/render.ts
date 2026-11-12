import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import type { Blueprint, SoundEvent } from "@swarmloom/core";
import type { Browser, Page } from "playwright-core";
import { type ContextOptions, launchBrowser, newContext, watchPage } from "../browser/launch";
import { applyNetworkPolicy } from "../browser/network";
import { snapshotPage } from "../browser/snapshot";
import type { FfmpegCaps } from "../discovery/ffmpeg";
import { RenderError, throwIfAborted } from "../errors";
import { type CliIo, warn } from "../io";
import { startStaticServer } from "../server/static";
import { Cleanup } from "../util/async";
import { moveIntoPlace } from "../util/fs";
import { trackTempDir } from "../util/owned";
import { type PlatformFont, RenderPageDriver } from "./driver";
import { type FrameImageType, formatHasAudio, frameImageType, type OutputFormat } from "./encode";
import { runFrameLoop } from "./frames";
import { inputBase, type RenderSource, servedInput, toRenderInput } from "./input";
import { type FrameWriter, ffmpegWriter, pngSequenceWriter } from "./output";
import { formatClock, Progress } from "./progress";
import type { RenderCue, RenderInfo, RenderInit, RenderScroll, StepResult } from "./protocol";

const SNAPSHOT_TIMEOUT_MS = 60_000;

/** Player settings forwarded verbatim to the render page. */
export type PlayerSettings = Omit<RenderInit, "input" | "width" | "height" | "fps" | "blueprint" | "cues">;

/** What a capture keeps besides the video, for --audio-out, --events-out and --manifest-out. */
export interface EvidenceRequest {
  /** Keep the soundtrack WAV bytes. */
  audio: boolean;
  /** Read the sound events from the page. */
  events: boolean;
  /** Capture lossless PNG frames, hash each one, and record browser and font details. */
  manifest: boolean;
}

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
  /** Capture exactly `maxDurationMs` of video even after the build is done (--duration). */
  fixedLength?: boolean;
  /** Player actions at fixed video times. */
  cues?: RenderCue[];
  evidence?: EvidenceRequest;
  /** Let the render page load https: images and fonts the input references (decision C03). */
  remoteAssets: boolean;
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
  /** Video time of the first frame that showed the build complete, or null. */
  builtAtMs: number | null;
  audio: boolean;
  last: StepResult;
  /** Requests the network policy refused (scripts, style sheets, plain http, other origins). */
  blockedRequests: number;
  /** What the page reported about the loaded input. */
  info: RenderInfo;
  /** Browser product version, e.g. "Chrome/150.0.7871.46" style strings from Playwright. */
  browserVersion: string;
  /** Present when evidence was requested. */
  evidence?: {
    imageType: FrameImageType;
    /** SHA-256 (hex) of every captured frame as the browser encoded it, in order (manifest only). */
    frameSha256: string[];
    wav?: Uint8Array;
    events?: SoundEvent[];
    /** Stretches of scrolling, read with the events. */
    scrolls?: RenderScroll[];
    fonts?: PlatformFont[] | null;
  };
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

    const base = inputBase(randomBytes(12).toString("base64url"));
    const server = await startStaticServer({ root: deps.renderDir, ...servedInput(job.source, base) });
    cleanup.defer(() => server.close());
    const origin = new URL(server.url).origin;
    const browser = await launchBrowser(deps.browserPath, (message) => {
      if (!job.quiet) warn(io, message);
    });
    cleanup.defer(() => browser.close());
    const evidence = job.evidence;
    const imageType = frameImageType(job.format, evidence?.manifest ?? false);
    const viewport: ContextOptions = {
      width: job.width,
      height: job.height,
      scale: job.scale,
      colorScheme: job.settings.theme === "dark" ? "dark" : "light",
      locale: job.settings.locale ?? "en-US",
    };

    const blueprint = await captureLivePage(browser, viewport, job, deps);
    const context = await newContext(browser, viewport);
    let blockedRequests = 0;
    await applyNetworkPolicy(context, { localOrigin: origin, remoteAssets: job.remoteAssets }, (url, type) => {
      blockedRequests += 1;
      if (job.verbose) io.err(`[network] blocked ${type} ${url}`);
    });
    const driver = await RenderPageDriver.open(context, {
      url: `${server.url}index.html`,
      width: job.width,
      height: job.height,
      scale: job.scale,
      imageType,
      io,
      verbose: job.verbose,
      signal,
    });
    const info = await driver.init({
      input: toRenderInput(job.source, origin + base),
      width: job.width,
      height: job.height,
      fps: job.fps,
      ...job.settings,
      ...(job.cues?.length ? { cues: job.cues } : {}),
      ...(blueprint ? { blueprint } : {}),
    });
    const estimate = info.estimatedMs || job.maxDurationMs;
    if (!job.fixedLength && estimate > job.maxDurationMs) {
      const need = formatClock(estimate / 1000);
      const max = formatClock(job.maxDurationMs / 1000);
      warn(io, `the build needs about ${need} but --max-duration is ${max}; the video will stop early`);
    }

    const writer = await createWriter(job, deps, tmp, imageType);
    cleanup.defer(() => writer.abort());
    const maxFrames = Math.max(1, Math.round((job.maxDurationMs * job.fps) / 1000));
    progress.expect(job.fixedLength ? maxFrames : Math.min(maxFrames, Math.ceil((estimate * job.fps) / 1000) + 1));
    const frameSha256: string[] = [];
    const sink = (frame: Uint8Array, index: number) => {
      if (evidence?.manifest) frameSha256.push(createHash("sha256").update(frame).digest("hex"));
      return writer.write(frame, index);
    };
    const result = await runFrameLoop(driver, sink, {
      fps: job.fps,
      maxFrames,
      untilDone: !job.fixedLength,
      signal,
      onFrame: (frame, step) => progress.update({ frame, ...step }),
    });
    const fonts = evidence?.manifest ? await driver.platformFonts() : undefined;

    progress.phase("encoding");
    let output = await writer.finish();
    let audio = false;
    let wav: Uint8Array | null = null;
    // A single frame never advanced the clock, so there is no soundtrack to render.
    if (job.settings.sound && formatHasAudio(job.format) && result.elapsedMs > 0) {
      progress.phase("rendering sound");
      // The whole video: the last frame lasts one frame past the elapsed time.
      wav = await driver.audioWav(result.durationMs);
      if (wav) {
        progress.phase("adding sound");
        output = await writer.addAudio(output, wav, result.durationMs);
        audio = true;
      }
    }
    const events = evidence?.events ? await driver.soundLog() : undefined;
    const scrolls = evidence?.events ? await driver.scrollLog() : undefined;
    const browserVersion = browser.version();
    await driver.dispose();
    progress.clear();
    await moveIntoPlace(output, job.output);
    return {
      frames: result.frames,
      durationMs: result.durationMs,
      finished: result.finished,
      builtAtMs: result.builtAtMs,
      audio,
      last: result.last,
      blockedRequests,
      info,
      browserVersion,
      ...(evidence
        ? {
            evidence: {
              imageType,
              frameSha256,
              ...(wav ? { wav } : {}),
              ...(events ? { events } : {}),
              ...(scrolls ? { scrolls } : {}),
              fonts,
            },
          }
        : {}),
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

function createWriter(job: RenderJob, deps: RenderDeps, tmp: string, imageType: FrameImageType): Promise<FrameWriter> {
  if (job.format === "png-seq") return pngSequenceWriter(tmp);
  if (!deps.ffmpeg) throw new RenderError("ffmpeg is required for this format");
  const { path: ffmpegPath, caps } = deps.ffmpeg;
  return Promise.resolve(
    ffmpegWriter(job.format, { ffmpegPath, caps, fps: job.fps, tmp, imageType, signal: deps.signal }),
  );
}
