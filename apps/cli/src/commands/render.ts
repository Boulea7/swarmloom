import { stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { expectPositionals, parseCommand, readEnum, readInt, readNumber } from "../args";
import { locateAssets, requireRenderDir } from "../assets";
import { findBrowser } from "../discovery/browser";
import { type FfmpegCaps, findFfmpeg, probeFfmpeg, systemFfmpegDeps } from "../discovery/ffmpeg";
import { type HostEnv, systemHost } from "../discovery/host";
import { installedPlaywright } from "../discovery/playwright";
import { MissingDependencyError, UsageError } from "../errors";
import { warn } from "../io";
import {
  FORMAT_EXTENSION,
  formatHasAudio,
  OUTPUT_FORMATS,
  type OutputFormat,
  planMux,
  planVideo,
} from "../pipeline/encode";
import { outputStem, resolveSource } from "../pipeline/input";
import { formatClock } from "../pipeline/progress";
import { type PlayerSettings, renderVideo } from "../pipeline/render";
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
      --events-out <path> Also write the sound log (every sound event, engine ms) as JSON

Swarm:
      --agents <n|auto>   Number of cursors (1-256) or auto. Default: auto
      --speed <n>         Build speed multiplier (0.05-16). Default: 1
      --seed <n>          Random seed; the same seed gives the same video (0-4294967295). Default: 1
      --theme <theme>     auto | light | dark. Default: auto
      --labels <mode>     names | agents | roles | none. Default: names
      --finale <finale>   flock | halo | none. Default: flock
      --follow <mode>     tour (scroll along with the build) | none. Default: tour
      --tail <ms>         Hold after the build finishes, ms (0-60000). Default: 2500
      --bpm <n>           Tempo the placement notes snap to (40-240). Default: 112
      --locale <tag>      Language of the toolbar strings and the page (BCP 47). Default: en-US
      --no-sound          Leave out the soundtrack (GIF and WebP never have one)
      --no-remote         Do not load https images and fonts the input links to. Scripts, style sheets
                          and plain-http files from other sites are never loaded

Programs:
      --chrome <path>     Chrome/Chromium/Edge/Brave executable. Default: SWARMLOOM_CHROME, then
                          Playwright's chromium-headless-shell, then an installed browser
      --ffmpeg <path>     ffmpeg 4+ executable. Default: SWARMLOOM_FFMPEG, then PATH

  -q, --quiet             Errors only: no progress, warnings or summary
      --verbose           Echo the render page's console to stderr
  -h, --help              Show this help

Examples:
  swarmloom render README.md -o readme.mp4
  swarmloom render https://example.com --format webm --speed 2
  swarmloom render deck.pptx -o deck.gif --fps 15 --width 960 --height 540

Exit codes: 0 ok, 1 usage error, 2 missing Chrome/ffmpeg, 3 render failure, 130 interrupted.`;

const OPTIONS = {
  output: { type: "string", short: "o" },
  format: { type: "string", short: "f" },
  width: { type: "string" },
  height: { type: "string" },
  scale: { type: "string" },
  fps: { type: "string" },
  "max-duration": { type: "string" },
  "events-out": { type: "string" },
  bpm: { type: "string" },
  agents: { type: "string" },
  speed: { type: "string" },
  seed: { type: "string" },
  theme: { type: "string" },
  labels: { type: "string" },
  finale: { type: "string" },
  follow: { type: "string" },
  tail: { type: "string" },
  locale: { type: "string" },
  "no-sound": { type: "boolean" },
  "no-remote": { type: "boolean" },
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
  /** Absolute path of the sound log JSON (--events-out). */
  eventsOut?: string;
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
    finale: readEnum("finale", values.finale, ["flock", "halo", "none"], "flock"),
    follow: readEnum("follow", values.follow, ["tour", "none"], "tour"),
    tail: readInt("tail", values.tail, 2500, 0, 60_000),
    sound: !values["no-sound"] && formatHasAudio(format),
  };
  if (values.locale !== undefined) settings.locale = readLocale(values.locale);
  if (values.bpm !== undefined) settings.bpm = readNumber("bpm", values.bpm, 120, { min: 40, max: 240 });

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
    fps: readInt("fps", values.fps, 30, 1, 120),
    maxDurationMs: readNumber("max-duration", values["max-duration"], 120, { min: 1, max: 3600 }) * 1000,
    ...(values["events-out"] ? { eventsOut: path.resolve(cwd, values["events-out"]) } : {}),
    settings,
    chrome: values.chrome,
    ffmpeg: values.ffmpeg,
    quiet: values.quiet ?? false,
    verbose: values.verbose ?? false,
  };
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
async function prepareFfmpeg(opts: RenderOptions, host: HostEnv): Promise<{ path: string; caps: FfmpegCaps }> {
  try {
    const found = await findFfmpeg(systemFfmpegDeps(host), { flag: opts.ffmpeg });
    const caps = await probeFfmpeg(found.path);
    if (opts.format !== "png-seq") planVideo(opts.format, opts.fps, ".", caps);
    if (opts.settings.sound && (opts.format === "mp4" || opts.format === "webm")) {
      planMux(opts.format, { video: "v", wav: "a", output: "o", durationMs: 1000 }, caps);
    }
    return { path: found.path, caps };
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
  let ffmpeg: { path: string; caps: FfmpegCaps } | undefined;
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
      ...(opts.eventsOut ? { eventsOut: opts.eventsOut } : {}),
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
  if (opts.quiet) return 0;
  if (!summary.finished) {
    const layers = summary.last.total > 0 ? ` (${summary.last.built} of ${summary.last.total} layers built)` : "";
    warn(io, `stopped at --max-duration ${formatClock(opts.maxDurationMs / 1000)} before the build finished${layers}`);
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

export const renderCommand: Command = {
  name: "render",
  summary: "render <file|url>     Render a build to MP4, WebM, GIF, WebP or PNG frames, with sound",
  help: HELP,
  run,
};
