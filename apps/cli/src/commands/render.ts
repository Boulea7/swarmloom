import { stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import pkg from "../../package.json" with { type: "json" };
import { expectPositionals, parseCommand, readEnum, readInt, readNumber } from "../args";
import { locateAssets, requireRenderDir } from "../assets";
import { findBrowser } from "../discovery/browser";
import {
  type FfmpegCaps,
  type FfmpegVersion,
  findFfmpeg,
  formatFfmpegVersion,
  probeFfmpeg,
  systemFfmpegDeps,
} from "../discovery/ffmpeg";
import { type HostEnv, systemHost } from "../discovery/host";
import { installedPlaywright } from "../discovery/playwright";
import { MissingDependencyError, RenderError, UsageError } from "../errors";
import { warn } from "../io";
import {
  FORMAT_EXTENSION,
  formatHasAudio,
  OUTPUT_FORMATS,
  type OutputFormat,
  planMux,
  planVideo,
} from "../pipeline/encode";
import {
  buildManifest,
  cueFrame,
  eventsDocument,
  type ResolvedCue,
  sha256File,
  sourceDigest,
  writeAtomic,
} from "../pipeline/evidence";
import { outputStem, type RenderSource, resolveSource } from "../pipeline/input";
import { formatClock } from "../pipeline/progress";
import { type PlayerSettings, type RenderSummary, renderVideo } from "../pipeline/render";
import { isMissingOrEmptyDir } from "../util/fs";
import type { Command, CommandContext } from "./types";

const HELP = `Usage: swarmloom render <file|url> [options]

Render a file or web page to a video of the swarm building it, with sound.
Frames are captured one by one on a virtual clock, so the result does not depend on machine speed.

Output:
  -o, --output <path>     Output file (a directory for png-seq). Default: <input name>.<format>
  -f, --format <format>   mp4 | webm | gif | webp | png-seq. Default: from --output, else mp4
                          (png-seq when neither is given and ffmpeg is missing)
      --width <px>        Viewport width in CSS px (16-7680). Default: 1280
      --height <px>       Viewport height in CSS px (16-7680). Default: 720
      --scale <n>         Pixels per CSS px; the video is width*scale x height*scale (0.25-4). Default: 1
      --fps <n>           Frames per second (1-120). Default: 30
      --max-duration <s>  Stop after this many seconds of video (1-3600). Default: 120
      --duration <s>      Exact video length in seconds (0.1-3600): keeps capturing after the build
                          (the finale, then the finished page) and cuts an unfinished build there.
                          Replaces --max-duration

Swarm:
      --agents <n|auto>   Number of cursors (1-256) or auto. Default: auto
      --speed <n>         Build speed multiplier (0.05-16). Default: 1
      --seed <n>          Random seed; the same seed gives the same video (0-4294967295). Default: 1
      --theme <theme>     auto | light | dark. Default: auto
      --labels <mode>     names | agents | roles | none. Default: names
      --overlays <level>  full | minimal | none. minimal hides size badges, distance labels, guide
                          lines and rulers; none also hides selections, frames, pen lines, carets
                          and status bubbles. Default: full
      --finale <finale>   flock | halo | none. Default: flock
      --follow <mode>     tour (scroll along with the build) | none. Default: tour
      --tail <ms>         Hold after the build finishes, ms (0-60000): the finale, then the page
                          goes live and its own animations play. Default: 2500
      --no-live           Keep the finale through the whole tail instead of going live
      --locale <tag>      Language of the toolbar strings and the page (BCP 47). Default: en-US
      --bpm <n>           Tempo the placement notes, the fan-out and the final chord snap to (eighth
                          notes, 40-240). Default: 112
      --cue <at>:<action> Player action at a fixed video time; repeatable. <at> is seconds (12.5),
                          milliseconds (12500ms) or beats from the start at --bpm (26b). <action> is
                          pause (every cursor holds), resume, or finish (complete the build quickly).
                          Applied on the first frame at or after <at>; same-time cues in order given
      --no-sound          Leave out the soundtrack (GIF and WebP never have one)
      --no-remote         Do not load https images and fonts the input links to. Scripts, style sheets
                          and plain-http files from other sites are never loaded

Capture evidence (for repeatable takes; see the README):
      --audio-out <file>  Also write the soundtrack as WAV (48 kHz stereo, same length as the video)
      --events-out <file> Also write the sound log (every sound event) as JSON, in engine ms on the
                          frames' clock, with each event's frame number
      --manifest-out <file>
                          Write a JSON manifest: arguments, input and blueprint SHA-256, player
                          settings, cues, browser/ffmpeg/Node versions, fonts used, and the SHA-256
                          of every frame (frames are then captured as PNG) and of the sound log

Programs:
      --chrome <path>     Chrome/Chromium/Edge/Brave executable. Default: SWARMLOOM_CHROME, then
                          Playwright's chromium-headless-shell, then an installed browser
      --ffmpeg <path>     ffmpeg 4+ executable. Default: SWARMLOOM_FFMPEG, then PATH

  -q, --quiet             Errors only: no progress, warnings or summary
      --verbose           Echo the render page's console and blocked requests to stderr
  -h, --help              Show this help

Examples:
  swarmloom render README.md -o readme.mp4
  swarmloom render https://example.com --format webm --speed 2
  swarmloom render deck.pptx -o deck.gif --fps 15 --width 960 --height 540
  swarmloom render logo.svg -o take.mp4 --duration 24 --bpm 90 --cue 26b:pause --cue 28b:resume \
    --cue 28b:finish --audio-out take.wav --events-out events.json --manifest-out manifest.json

Exit codes: 0 ok, 1 usage error, 2 missing Chrome/ffmpeg, 3 render failure, 130 interrupted.`;

const OPTIONS = {
  output: { type: "string", short: "o" },
  format: { type: "string", short: "f" },
  width: { type: "string" },
  height: { type: "string" },
  scale: { type: "string" },
  fps: { type: "string" },
  "max-duration": { type: "string" },
  duration: { type: "string" },
  bpm: { type: "string" },
  cue: { type: "string", multiple: true },
  "audio-out": { type: "string" },
  "events-out": { type: "string" },
  "manifest-out": { type: "string" },
  agents: { type: "string" },
  speed: { type: "string" },
  seed: { type: "string" },
  theme: { type: "string" },
  labels: { type: "string" },
  overlays: { type: "string" },
  finale: { type: "string" },
  follow: { type: "string" },
  tail: { type: "string" },
  locale: { type: "string" },
  "no-sound": { type: "boolean" },
  "no-remote": { type: "boolean" },
  "no-live": { type: "boolean" },
  chrome: { type: "string" },
  ffmpeg: { type: "string" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/** Largest output dimension in device pixels (encoders and memory stay sane below it). */
const MAX_OUTPUT_PX = 8192;

/** Validated `render` options. */
export interface RenderOptions {
  input: string;
  /** Absolute output path. */
  output: string;
  format: OutputFormat;
  /** True when neither --output nor --format chose the format (it may fall back to png-seq). */
  formatDefaulted: boolean;
  width: number;
  height: number;
  scale: number;
  fps: number;
  maxDurationMs: number;
  /** --duration: exactly maxDurationMs of video. */
  fixedLength: boolean;
  cues: ResolvedCue[];
  /** Absolute evidence paths. */
  audioOut?: string;
  eventsOut?: string;
  manifestOut?: string;
  settings: PlayerSettings;
  noSound: boolean;
  /** Load https: images and fonts (default on; --no-remote turns it off). */
  remoteAssets: boolean;
  chrome?: string;
  ffmpeg?: string;
  quiet: boolean;
  verbose: boolean;
}

/**
 * Parses and validates `render` arguments.
 * @returns The options, or "help" when --help was given.
 * @throws UsageError describing the first invalid argument.
 */
export function parseRenderOptions(argv: string[], cwd: string): RenderOptions | "help" {
  const { values, positionals } = parseCommand("render", argv, OPTIONS);
  if (values.help) return "help";
  const [input] = expectPositionals("render", positionals, ["<file|url>"]) as [string];

  const width = readInt("width", values.width, 1280, 16, 7680);
  const height = readInt("height", values.height, 720, 16, 7680);
  const scale = readNumber("scale", values.scale, 1, { min: 0.25, max: 4 });
  if (Math.round(width * scale) > MAX_OUTPUT_PX || Math.round(height * scale) > MAX_OUTPUT_PX) {
    throw new UsageError(
      `The video would be larger than ${MAX_OUTPUT_PX} px on a side; lower --width, --height or --scale`,
    );
  }
  const agentsRaw = values.agents;
  const agents = agentsRaw === undefined || agentsRaw === "auto" ? "auto" : readInt("agents", agentsRaw, 0, 1, 256);
  const { output, format } = resolveOutput(input, values.output, values.format, cwd);

  const settings: PlayerSettings = {
    agents,
    speed: readNumber("speed", values.speed, 1, { min: 0.05, max: 16 }),
    seed: readInt("seed", values.seed, 1, 0, 0xffffffff),
    theme: readEnum("theme", values.theme, ["auto", "light", "dark"], "auto"),
    labels: readEnum("labels", values.labels, ["names", "agents", "roles", "none"], "names"),
    overlays: readEnum("overlays", values.overlays, ["full", "minimal", "none"], "full"),
    finale: readEnum("finale", values.finale, ["flock", "halo", "none"], "flock"),
    follow: readEnum("follow", values.follow, ["tour", "none"], "tour"),
    tail: readInt("tail", values.tail, 2500, 0, 60_000),
    live: !values["no-live"],
    sound: !values["no-sound"] && formatHasAudio(format),
  };
  if (values.locale !== undefined) settings.locale = readLocale(values.locale);
  if (values.bpm !== undefined) settings.bpm = readNumber("bpm", values.bpm, 120, { min: 40, max: 240 });

  if (values.duration !== undefined && values["max-duration"] !== undefined) {
    throw new UsageError("Use either --duration (exact length) or --max-duration (upper limit), not both");
  }
  const fixedLength = values.duration !== undefined;
  const maxDurationMs = fixedLength
    ? readNumber("duration", values.duration, 0, { min: 0.1, max: 3600 }) * 1000
    : readNumber("max-duration", values["max-duration"], 120, { min: 1, max: 3600 }) * 1000;
  const fps = readInt("fps", values.fps, 30, 1, 120);
  const cues = (values.cue ?? []).map((spec) => parseCue(spec, settings.bpm, fps));
  for (const cue of cues) {
    if (cue.at >= maxDurationMs) {
      throw new UsageError(`--cue ${cue.spec} is at or after the end of the video (${maxDurationMs / 1000} s)`);
    }
  }
  const evidence = {
    audioOut: values["audio-out"] ? path.resolve(cwd, values["audio-out"]) : undefined,
    eventsOut: values["events-out"] ? path.resolve(cwd, values["events-out"]) : undefined,
    manifestOut: values["manifest-out"] ? path.resolve(cwd, values["manifest-out"]) : undefined,
  };
  if (evidence.audioOut && !settings.sound) {
    throw new UsageError("--audio-out needs sound: drop --no-sound and use mp4, webm or png-seq");
  }
  const files = [output, evidence.audioOut, evidence.eventsOut, evidence.manifestOut].filter(Boolean);
  if (new Set(files).size !== files.length) {
    throw new UsageError("--output, --audio-out, --events-out and --manifest-out must be different files");
  }

  return {
    input,
    output,
    format,
    formatDefaulted: !values.output && values.format === undefined,
    width,
    height,
    scale,
    noSound: values["no-sound"] ?? false,
    remoteAssets: !values["no-remote"],
    fps,
    maxDurationMs,
    fixedLength,
    cues,
    ...evidence,
    settings,
    chrome: values.chrome,
    ffmpeg: values.ffmpeg,
    quiet: values.quiet ?? false,
    verbose: values.verbose ?? false,
  };
}

const CUE_RE = /^(\d+(?:\.\d+)?|\.\d+)(s|ms|b)?:(pause|resume|finish)$/;

/**
 * Parses one --cue: "<time>[s|ms|b]:<action>"; beats ("b") count from the start of the video at `bpm`.
 * @throws UsageError for bad syntax or beats without --bpm.
 */
export function parseCue(spec: string, bpm: number | undefined, fps: number): ResolvedCue {
  const match = CUE_RE.exec(spec.trim());
  if (!match) {
    throw new UsageError(
      `--cue must look like <time>:<action>, e.g. 12.5:pause, 12500ms:resume or 26b:finish (got "${spec}")`,
    );
  }
  const [, value = "0", unit = "s", action] = match;
  if (unit === "b" && bpm === undefined) throw new UsageError(`--cue ${spec} counts beats, which needs --bpm`);
  const n = Number(value);
  const at = unit === "ms" ? n : unit === "b" ? (n * 60_000) / (bpm as number) : n * 1000;
  return { spec, at, frame: cueFrame(at, fps), action: action as ResolvedCue["action"] };
}

function readLocale(raw: string): string {
  try {
    return Intl.getCanonicalLocales(raw)[0] ?? raw;
  } catch {
    throw new UsageError(`--locale must be a BCP 47 language tag such as en-US or zh-CN (got "${raw}")`);
  }
}

/**
 * Picks the output path and format from --output and --format.
 * @throws UsageError when they disagree or the format cannot be inferred.
 */
export function resolveOutput(
  input: string,
  outputRaw: string | undefined,
  formatRaw: string | undefined,
  cwd: string,
): { output: string; format: OutputFormat } {
  const explicit = formatRaw === undefined ? undefined : readEnum("format", formatRaw, OUTPUT_FORMATS, "mp4");
  if (outputRaw === undefined || outputRaw === "") {
    const format = explicit ?? "mp4";
    return { output: path.resolve(cwd, outputStem(input) + (FORMAT_EXTENSION[format] ?? "-frames")), format };
  }
  const ext = path.extname(outputRaw).toLowerCase();
  const inferred = OUTPUT_FORMATS.find((f) => FORMAT_EXTENSION[f] === ext);
  const output = path.resolve(cwd, outputRaw);
  if (explicit) {
    if (inferred && inferred !== explicit) {
      throw new UsageError(`--output ends in ${ext} but --format is ${explicit}`);
    }
    return { output, format: explicit };
  }
  if (!inferred) {
    throw new UsageError(
      `Cannot tell the video format from "${outputRaw}"`,
      "Use a .mp4, .webm, .gif or .webp name, or add --format (png-seq writes a directory).",
    );
  }
  return { output, format: inferred };
}

async function checkOutputPath(opts: RenderOptions): Promise<void> {
  if (opts.format === "png-seq") {
    if (!(await isMissingOrEmptyDir(opts.output))) {
      throw new UsageError(
        `Output directory is not empty: ${opts.output}`,
        "Choose a new or empty directory for png-seq.",
      );
    }
    return;
  }
  const info = await stat(opts.output).catch(() => null);
  if (info?.isDirectory()) throw new UsageError(`Output is a directory: ${opts.output}`);
}

/** Options for the ffmpeg-less fallback: png-seq into "<input>-frames", sound kept unless --no-sound. */
function pngSequenceFallback(opts: RenderOptions, cwd: string): Partial<RenderOptions> {
  const { output } = resolveOutput(opts.input, undefined, "png-seq", cwd);
  return { format: "png-seq", output, settings: { ...opts.settings, sound: !opts.noSound } };
}

/**
 * Finds ffmpeg and checks it has every encoder the job needs, so a missing encoder fails now rather
 * than after minutes of capturing.
 * @throws MissingDependencyError that also suggests png-seq, which needs no ffmpeg.
 */
async function prepareFfmpeg(
  opts: RenderOptions,
  host: HostEnv,
): Promise<{ path: string; caps: FfmpegCaps; version: FfmpegVersion }> {
  try {
    const found = await findFfmpeg(systemFfmpegDeps(host), { flag: opts.ffmpeg });
    const caps = await probeFfmpeg(found.path);
    if (opts.format !== "png-seq") planVideo(opts.format, opts.fps, ".", caps);
    if (opts.settings.sound && (opts.format === "mp4" || opts.format === "webm")) {
      planMux(opts.format, { video: "v", wav: "a", output: "o", durationMs: 1000 }, caps);
    }
    return { path: found.path, caps, version: found.version };
  } catch (error) {
    if (!(error instanceof MissingDependencyError)) throw error;
    const fallback = "Without ffmpeg, --format png-seq writes PNG frames plus audio.wav.";
    throw new MissingDependencyError(error.message, error.hint ? `${error.hint}\n${fallback}` : fallback, {
      cause: error,
    });
  }
}

async function run(argv: string[], ctx: CommandContext): Promise<number> {
  const { io } = ctx;
  const opts = parseRenderOptions(argv, ctx.cwd);
  if (opts === "help") {
    io.out(HELP);
    return 0;
  }
  // Input problems are the user's to fix first; they are reported before missing programs.
  const source = await resolveSource(opts.input, { cwd: ctx.cwd, signal: ctx.signal });
  const host = ctx.host ?? systemHost(ctx.env);
  const browser = findBrowser(host, { flag: opts.chrome, playwright: installedPlaywright() });
  let ffmpeg: { path: string; caps: FfmpegCaps; version: FfmpegVersion } | undefined;
  if (opts.format !== "png-seq") {
    try {
      ffmpeg = await prepareFfmpeg(opts, host);
    } catch (error) {
      if (!(error instanceof MissingDependencyError) || !opts.formatDefaulted) throw error;
      Object.assign(opts, pngSequenceFallback(opts, ctx.cwd));
      if (!opts.quiet) warn(io, `${error.message}; writing PNG frames and audio.wav instead (see swarmloom doctor)`);
    }
  }
  await checkOutputPath(opts);
  const assets = ctx.assets ?? locateAssets(ctx.env);
  const renderDir = requireRenderDir(assets);

  const target = path.relative(ctx.cwd, opts.output) || opts.output;
  const pixels = `${Math.round(opts.width * opts.scale)}x${Math.round(opts.height * opts.scale)}`;
  if (!opts.quiet) {
    const kind = source.kind === "page" ? "web page" : source.format;
    io.err(`Rendering ${source.name} (${kind}) at ${pixels}, ${opts.fps} fps -> ${target}`);
  }
  const started = performance.now();
  const quietIo = opts.quiet ? { ...io, err: () => {}, tty: undefined } : io;
  const summary = await renderVideo(
    {
      source,
      output: opts.output,
      format: opts.format,
      width: opts.width,
      height: opts.height,
      scale: opts.scale,
      fps: opts.fps,
      settings: opts.settings,
      maxDurationMs: opts.maxDurationMs,
      fixedLength: opts.fixedLength,
      cues: opts.cues.map(({ at, action }) => ({ at, action })),
      evidence: wantsEvidence(opts)
        ? { audio: Boolean(opts.audioOut), events: Boolean(opts.eventsOut), manifest: Boolean(opts.manifestOut) }
        : undefined,
      remoteAssets: opts.remoteAssets,
      quiet: opts.quiet,
      verbose: opts.verbose,
    },
    {
      io: quietIo,
      signal: ctx.signal,
      browserPath: browser.path,
      ffmpeg,
      renderDir,
      snapshotBundle: assets.snapshotBundle,
      tmpRoot: ctx.tmpRoot,
    },
  );
  await writeEvidence(opts, summary, {
    argv: ["render", ...argv],
    cwd: ctx.cwd,
    source,
    browserPath: browser.path,
    ffmpeg: ffmpeg ? { path: ffmpeg.path, version: formatFfmpegVersion(ffmpeg.version) } : null,
  });
  if (opts.quiet) return 0;
  if (!summary.finished) {
    const layers = summary.last.total > 0 ? ` (${summary.last.built} of ${summary.last.total} layers built)` : "";
    const flag = opts.fixedLength ? "--duration" : "--max-duration";
    warn(io, `stopped at ${flag} ${formatClock(opts.maxDurationMs / 1000)} before the build finished${layers}`);
  }
  if (summary.blockedRequests > 0 && !opts.verbose) {
    warn(io, `blocked ${summary.blockedRequests} request(s) the input made to other sites (see --verbose)`);
  }
  const sound = summary.audio ? "with sound" : "no sound";
  const took = formatClock((performance.now() - started) / 1000);
  io.err(
    `Wrote ${target}: ${(summary.durationMs / 1000).toFixed(1)} s, ${summary.frames} frames, ${pixels}, ${sound} (took ${took})`,
  );
  return 0;
}

function wantsEvidence(opts: RenderOptions): boolean {
  return Boolean(opts.audioOut || opts.eventsOut || opts.manifestOut);
}

/** Writes --audio-out, --events-out and then --manifest-out (which hashes the other outputs). */
async function writeEvidence(
  opts: RenderOptions,
  summary: RenderSummary,
  run: {
    argv: string[];
    cwd: string;
    source: RenderSource;
    browserPath: string;
    ffmpeg: { path: string; version: string } | null;
  },
): Promise<void> {
  const evidence = summary.evidence;
  if (!evidence) return;
  if (opts.audioOut) {
    if (!evidence.wav) throw new RenderError("The render produced no soundtrack for --audio-out");
    await writeAtomic(opts.audioOut, evidence.wav);
  }
  if (opts.eventsOut && evidence.events) {
    const meta = { fps: opts.fps, frames: summary.frames, durationMs: summary.durationMs, bpm: opts.settings.bpm };
    await writeAtomic(opts.eventsOut, eventsDocument(evidence.events, meta));
  }
  if (!opts.manifestOut) return;
  const outputs: Record<string, { path: string; sha256: string; bytes: number }> = {};
  const named: [string, string | undefined][] = [
    ["video", opts.format === "png-seq" ? undefined : opts.output],
    ["audio", opts.audioOut],
    ["events", opts.eventsOut],
  ];
  for (const [name, file] of named) if (file) outputs[name] = { path: file, ...(await sha256File(file)) };
  const playwright = installedPlaywright();
  const input = { arg: opts.input, kind: run.source.kind, name: run.source.name, ...(await sourceDigest(run.source)) };
  const manifest = buildManifest({
    tool: { name: "swarmloom", version: pkg.version },
    argv: run.argv,
    cwd: run.cwd,
    input: { ...input, format: run.source.kind === "page" ? "html" : run.source.format },
    info: summary.info,
    video: { format: opts.format, width: opts.width, height: opts.height, scale: opts.scale, fps: opts.fps },
    settings: opts.settings,
    fixedLength: opts.fixedLength,
    maxDurationMs: opts.maxDurationMs,
    cues: opts.cues,
    programs: {
      browser: { path: run.browserPath, version: summary.browserVersion },
      ffmpeg: run.ffmpeg,
      playwrightCore: playwright.version ?? null,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    fonts: evidence.fonts,
    result: {
      frames: summary.frames,
      durationMs: summary.durationMs,
      builtAtMs: summary.builtAtMs,
      finished: summary.finished,
      imageType: evidence.imageType,
      frameSha256: evidence.frameSha256,
    },
    events: evidence.events,
    outputs,
  });
  await writeAtomic(opts.manifestOut, `${JSON.stringify(manifest, null, 1)}\n`);
}

export const renderCommand: Command = {
  name: "render",
  summary: "render <file|url>     Render a build to MP4, WebM, GIF, WebP or PNG frames, with sound",
  help: HELP,
  run,
};
