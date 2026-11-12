import { stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
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
  type PathArg,
  type ResolvedCue,
  sha256File,
  sourceDigest,
  writeAtomic,
} from "../pipeline/evidence";
import { inputFilePath, isWebUrl, outputStem, type RenderSource, resolveSource } from "../pipeline/input";
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
      --labels <mode>     names | agents | roles | none (no name tags and no status bubbles).
                          Default: names
      --overlays <level>  full | minimal | none. minimal hides size badges, distance labels, guide
                          lines and rulers; none also hides selections, frames, pen lines, carets
                          and status bubbles. Default: full
      --finale <finale>   flock | halo | none. Default: flock
      --follow <mode>     tour (scroll along with the build) | none. Default: tour
      --opening <time>    Show the finished page or document first for <time> (seconds, ms or beats,
                          as for --cue), then fade it into the blank canvas and build. Default: off
      --intro <style>     warp (cursors circle the file icon, then fan out) | outline (three
                          cursors draw the largest shapes, then the rest joins) | none. Default: warp
      --tail <ms>         Hold after the build finishes, ms (0-60000): the finale, then the page
                          goes live and its own animations play. Default: 2500
      --no-live           Keep the finale through the whole tail instead of going live
      --live-top          Going live glides back to the top of the page while the cursors leave
      --locale <tag>      Language of the toolbar strings and the page (BCP 47). Default: en-US
      --bpm <n>           Tempo the placement notes, the fan-out and the final chord snap to (eighth
                          notes, 40-240). Default: 112
      --beat-sync <set>   notes | all. all also puts keys, clicks, snaps and pen anchors on the
                          nearest sixteenth note (up to 30 ms early or 60 ms late, one per sound
                          and sixteenth) and leaves out the ones too far off. Default: notes
      --cue <at>:<action> Player action at a fixed video time; repeatable. <at> is seconds (12.5),
                          milliseconds (12500ms) or beats from the start at --bpm (26b). <action> is
                          pause (every cursor holds), resume, finish (complete the build quickly),
                          live (go live then, not when the finale settles; also with --no-live) or
                          speed=<n> (build speed from then on, 0.05-16; e.g. 0:speed=0.6 then
                          17b:speed=0.45 hurries only the start). Applied on the first frame at or
                          after <at>; same-time cues in order given
      --no-sound          Leave out the soundtrack (GIF and WebP never have one)
      --no-remote         Do not load https images and fonts the input links to. Scripts, style sheets
                          and plain-http files from other sites are never loaded

Capture evidence (for repeatable takes; see the README):
      --audio-out <file>  Also write the soundtrack as WAV (48 kHz stereo, same length as the video)
      --events-out <file> Also write the sound log (every sound event) as JSON, in engine ms on the
                          frames' clock, with each event's frame number and the time the soundtrack
                          plays it (on the beat grid, or null when it stays silent)
      --manifest-out <file>
                          Write a JSON manifest: arguments, input and blueprint SHA-256, player
                          settings, cues, browser/ffmpeg/Node versions, fonts used, and the SHA-256
                          of every frame (frames are then captured as PNG) and of the sound log.
                          Made to share: file paths (arguments too) relative to it, programs by
                          name, no working directory, and URL user info, query and fragment redacted

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

/** Build speeds --speed and speed cues accept. */
const SPEED_RANGE = { min: 0.05, max: 16 } as const;

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
  "beat-sync": { type: "string" },
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
  intro: { type: "string" },
  tail: { type: "string" },
  locale: { type: "string" },
  "no-sound": { type: "boolean" },
  "no-remote": { type: "boolean" },
  "no-live": { type: "boolean" },
  opening: { type: "string" },
  "live-top": { type: "boolean" },
  chrome: { type: "string" },
  ffmpeg: { type: "string" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/** Options whose value is a file the render writes or a program it runs, for the manifest. */
const PATH_OPTIONS: Partial<Record<keyof typeof OPTIONS, PathArg["kind"]>> = {
  output: "file",
  "audio-out": "file",
  "events-out": "file",
  "manifest-out": "file",
  chrome: "program",
  ffmpeg: "program",
};

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
    speed: readNumber("speed", values.speed, 1, SPEED_RANGE),
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
  const intro = readEnum("intro", values.intro, ["warp", "outline", "none"], "warp");
  if (intro !== "warp") settings.intro = intro === "outline" ? "outline" : false;
  if (values.locale !== undefined) settings.locale = readLocale(values.locale);
  if (values.bpm !== undefined) settings.bpm = readNumber("bpm", values.bpm, 120, { min: 40, max: 240 });
  if (values.opening !== undefined) {
    const opening = parseOpening(values.opening, settings.bpm);
    if (opening > 0) settings.opening = opening;
  }
  if (values["live-top"]) settings.liveTop = true;
  if (readEnum("beat-sync", values["beat-sync"], ["notes", "all"], "notes") === "all") settings.beatSync = "all";

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
  if (hasSharedPath([output, evidence.audioOut, evidence.eventsOut, evidence.manifestOut])) {
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

/** True when two of the given output paths name one file (see {@link sameFileKey}). */
function hasSharedPath(files: (string | undefined)[]): boolean {
  const present = files.filter((file): file is string => file !== undefined);
  return new Set(present.map(sameFileKey)).size !== present.length;
}

/**
 * Comparison key for "is this the same file?": NTFS and default APFS volumes ignore case (APFS also
 * Unicode normalization), so `take.mp4` and `TAKE.MP4` name one file there, and Win32 drops trailing
 * dots and spaces from path segments, so `take.mp4.` and `take.mp4 ` open `take.mp4` (path.resolve
 * keeps them). Folding on every platform rejects such twins where they are distinct files too, which
 * is harmless next to overwriting the video.
 */
function sameFileKey(file: string): string {
  return caseFold(file).split(path.sep).map(trimTrailingDotsAndSpaces).join(path.sep);
}

/**
 * Case-insensitive file systems fold case, which lowercasing alone misses: `Σ` lowercases to `σ` but
 * the final sigma `ς` stays `ς`, and `ẞ` lowercases to `ß` while `ß` uppercases to `SS`. Going through
 * upper case maps every such pair to one string; NFD first and NFC last make canonically equivalent
 * spellings agree, as Unicode's canonical caseless match does. It folds a little more than the file
 * systems (`ß` and `ss` share a key), which only rejects a rare distinct pair.
 */
function caseFold(text: string): string {
  return text.normalize("NFD").toLowerCase().toUpperCase().toLowerCase().normalize("NFC");
}

function trimTrailingDotsAndSpaces(segment: string): string {
  let end = segment.length;
  while (end > 0 && (segment[end - 1] === "." || segment[end - 1] === " ")) end--;
  return segment.slice(0, end);
}

/** A time: seconds (12.5), milliseconds (12500ms) or beats at --bpm (26b). */
const TIME = String.raw`(\d+(?:\.\d+)?|\.\d+)(s|ms|b)?`;
const CUE_RE = new RegExp(String.raw`^${TIME}:(pause|resume|finish|live|speed=(\d+(?:\.\d+)?|\.\d+))$`);
const TIME_RE = new RegExp(`^${TIME}$`);
/** Longest --opening, ms. */
const MAX_OPENING_MS = 60_000;

/**
 * A matched time in ms; beats count from the start of the video at `bpm`.
 * @throws UsageError for beats without --bpm.
 */
function timeMs(value: string, unit: string, bpm: number | undefined, what: string): number {
  if (unit === "b" && bpm === undefined) throw new UsageError(`${what} counts beats, which needs --bpm`);
  const n = Number(value);
  return unit === "ms" ? n : unit === "b" ? (n * 60_000) / (bpm as number) : n * 1000;
}

/**
 * Parses --opening: a time as --cue takes it, at most a minute; 0 means no opening.
 * @throws UsageError for bad syntax, beats without --bpm or a longer time.
 */
export function parseOpening(spec: string, bpm: number | undefined): number {
  const match = TIME_RE.exec(spec.trim());
  if (!match) throw new UsageError(`--opening must be a time such as 1.5, 1500ms or 4b (got "${spec}")`);
  const [, value = "0", unit = "s"] = match;
  const ms = timeMs(value, unit, bpm, `--opening ${spec}`);
  if (ms > MAX_OPENING_MS) throw new UsageError(`--opening must be at most ${MAX_OPENING_MS / 1000} s (got "${spec}")`);
  return ms;
}

/**
 * Parses one --cue: "<time>[s|ms|b]:<action>"; beats ("b") count from the start of the video at `bpm`.
 * The action "speed=<n>" sets the build speed from then on.
 * @throws UsageError for bad syntax, a speed outside the --speed range or beats without --bpm.
 */
export function parseCue(spec: string, bpm: number | undefined, fps: number): ResolvedCue {
  const match = CUE_RE.exec(spec.trim());
  if (!match) {
    throw new UsageError(
      `--cue must look like <time>:<action>, e.g. 12.5:pause, 12500ms:resume, 26b:finish or 0:speed=0.6 (got "${spec}")`,
    );
  }
  const [, value = "0", unit = "s", action = "", speedText] = match;
  const at = timeMs(value, unit, bpm, `--cue ${spec}`);
  const frame = cueFrame(at, fps);
  if (speedText === undefined) return { spec, at, frame, action: action as ResolvedCue["action"] };
  const speed = Number(speedText);
  if (!(speed >= SPEED_RANGE.min && speed <= SPEED_RANGE.max)) {
    throw new UsageError(`--cue ${spec}: the speed must be ${SPEED_RANGE.min}-${SPEED_RANGE.max}`);
  }
  return { spec, at, frame, action: "speed", speed };
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

/**
 * Refuses an output path that is the input file: the video and the evidence files replace whatever is
 * at their path, so the source would be lost. Compares the names (see {@link sameFileKey}) and, for
 * paths that exist, the file identity, which also catches links to the input.
 * @throws UsageError naming the output.
 */
async function checkInputKept(opts: RenderOptions, cwd: string): Promise<void> {
  if (isWebUrl(opts.input)) return;
  const input = inputFilePath(opts.input, cwd);
  const inputId = await fileId(input);
  const outputs: [string, string | undefined][] = [
    ["The output", opts.output],
    ["--audio-out", opts.audioOut],
    ["--events-out", opts.eventsOut],
    ["--manifest-out", opts.manifestOut],
  ];
  for (const [label, file] of outputs) {
    if (!file) continue;
    if (sameFileKey(file) === sameFileKey(input) || (inputId !== null && (await fileId(file)) === inputId)) {
      throw new UsageError(`${label} would overwrite the input ${input}`, "Write every output to another file.");
    }
  }
}

/** Device and inode of an existing file, or null (missing, or no stable inode on this file system). */
async function fileId(file: string): Promise<string | null> {
  const info = await stat(file, { bigint: true }).catch(() => null);
  return info && info.ino !== 0n ? `${info.dev}:${info.ino}` : null;
}

/**
 * Options for the ffmpeg-less fallback: png-seq into "<input>-frames", sound kept unless --no-sound.
 * The frame directory replaces the default video path that parseRenderOptions checked, so it is
 * checked against the evidence paths again here, before any frame is captured.
 * @param reason Why ffmpeg cannot be used, shown when the fallback is refused.
 * @throws UsageError when an evidence path names the frame directory.
 */
function pngSequenceFallback(opts: RenderOptions, cwd: string, reason: string): Partial<RenderOptions> {
  const { output } = resolveOutput(opts.input, undefined, "png-seq", cwd);
  if (hasSharedPath([output, opts.audioOut, opts.eventsOut, opts.manifestOut])) {
    throw new UsageError(
      `${reason}; the PNG frames that replace the video would go to ${output}, which an evidence output also names`,
      "Point --audio-out, --events-out and --manifest-out elsewhere, or install ffmpeg (see swarmloom doctor).",
    );
  }
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
  await checkInputKept(opts, ctx.cwd);
  const host = ctx.host ?? systemHost(ctx.env);
  const browser = findBrowser(host, { flag: opts.chrome, playwright: installedPlaywright() });
  let ffmpeg: { path: string; caps: FfmpegCaps; version: FfmpegVersion } | undefined;
  if (opts.format !== "png-seq") {
    try {
      ffmpeg = await prepareFfmpeg(opts, host);
    } catch (error) {
      if (!(error instanceof MissingDependencyError) || !opts.formatDefaulted) throw error;
      Object.assign(opts, pngSequenceFallback(opts, ctx.cwd, error.message));
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
      cues: opts.cues.map(({ at, action, speed }) => (speed === undefined ? { at, action } : { at, action, speed })),
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
    pathArgs: renderPathArgs(argv),
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

/**
 * Where valid `render` arguments name the input, output files and programs, with indexes into
 * `["render", ...argv]` (the manifest's argv), for {@link buildManifest} to make them shareable.
 */
export function renderPathArgs(argv: string[]): PathArg[] {
  const { tokens } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true, tokens: true });
  const found: PathArg[] = [];
  for (const token of tokens) {
    if (token.kind === "positional") found.push({ index: token.index + 1, value: token.value, kind: "input" });
    if (token.kind !== "option" || token.value === undefined) continue;
    const kind = PATH_OPTIONS[token.name as keyof typeof OPTIONS];
    // A value not inline (--output take.mp4) is the argument after the option.
    if (kind) found.push({ index: token.index + (token.inlineValue ? 1 : 2), value: token.value, kind });
  }
  return found;
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
    pathArgs: PathArg[];
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
    const { bpm, beatSync } = opts.settings;
    const meta = { fps: opts.fps, frames: summary.frames, durationMs: summary.durationMs, bpm, beatSync };
    await writeAtomic(opts.eventsOut, eventsDocument(evidence.events, meta, evidence.scrolls));
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
    pathArgs: run.pathArgs,
    cwd: run.cwd,
    manifestFile: opts.manifestOut,
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
