/**
 * Capture evidence for `render --audio-out/--events-out/--manifest-out`: the soundtrack WAV, the
 * sound events on video time, and a manifest that pins everything needed to reproduce and verify a
 * render (input and blueprint hashes, settings, cues, program versions, fonts, per-frame hashes).
 *
 * Nothing here depends on wall-clock time, so two renders with the same arguments on the same
 * machine produce the same events file and the same manifest apart from output paths.
 *
 * The manifest is meant to travel with the take, so it leaves out where things live on this machine:
 * no working directory, programs by file name only, files relative to the manifest (see
 * {@link shareablePath}), in the arguments as well as the outputs, and http(s) URLs without user
 * info, query or fragment (see {@link redactUrl}).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type SoundEvent, soundTimes } from "@swarmloom/core";
import type { PlatformFont } from "./driver";
import type { FrameImageType, OutputFormat } from "./encode";
import { inputFilePath, isWebUrl, type RenderSource } from "./input";
import type { RenderCue, RenderInfo, RenderScroll } from "./protocol";
import type { PlayerSettings } from "./render";

/** Bumped when a field changes meaning; readers must check it. */
export const MANIFEST_VERSION = 1;
/** Bumped when a field of the events file changes meaning or goes away (new fields may appear). */
export const EVENTS_VERSION = 1;

/** A cue as given on the command line and as resolved for the render. */
export interface ResolvedCue extends RenderCue {
  /** The --cue text, e.g. "26b:pause". */
  spec: string;
  /** First frame whose time is at or after `at` (where the cue takes effect). */
  frame: number;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 and size of a file, streamed. */
export function sha256File(file: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    createReadStream(file)
      .on("data", (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });
}

/** SHA-256 and size of the input exactly as read (file bytes, downloaded bytes or page HTML). */
export async function sourceDigest(source: RenderSource): Promise<{ sha256: string; bytes: number }> {
  if (source.kind === "page") return digest(new TextEncoder().encode(source.html));
  const { content } = source;
  if ("path" in content) return sha256File(content.path);
  return digest("bytes" in content ? content.bytes : new TextEncoder().encode(content.text));
}

function digest(bytes: Uint8Array): { sha256: string; bytes: number } {
  return { sha256: sha256Hex(bytes), bytes: bytes.byteLength };
}

/** First frame at or after `ms` (float slack for times computed from beats). */
export function cueFrame(ms: number, fps: number): number {
  return Math.max(0, Math.ceil((ms * fps) / 1000 - 1e-6));
}

/**
 * The canonical sound log: events in emission order, keys in a fixed order. Its JSON is what the
 * manifest's `sound.soundLogSha256` hashes, so two runs can be compared without the events file.
 */
export function soundLogJson(events: readonly SoundEvent[]): string {
  return JSON.stringify(events);
}

/**
 * The --events-out document: the sound log plus the nearest frame of each event and the time the
 * soundtrack plays it. Event times (`t`) are when the engine raised them; `at` is where the mixer puts
 * the sound (the beat grid moves "note", "fanout" and "chord", and with --beat-sync all the hits too),
 * or null when it stays silent, including a sound the grid pushes to or past the video's end (the
 * soundtrack is `durationMs` long and drops it). `at` is worked out the same way without a soundtrack
 * (--no-sound, GIF).
 * `scrolls` lists each stretch of scrolling on the same clock, with the frames it starts and ends on.
 */
export function eventsDocument(
  events: readonly SoundEvent[],
  meta: { fps: number; frames: number; durationMs: number; bpm?: number; beatSync?: true | "all" },
  scrolls: readonly RenderScroll[] = [],
): string {
  const frameOf = (t: number) => Math.round((t * meta.fps) / 1000);
  const heard = soundTimes(events, { bpm: meta.bpm, sound: { beatSync: meta.beatSync ?? true } });
  // renderOffline() leaves out every sound at or after the end of the video.
  const heardAt = (i: number) => {
    const at = heard[i] ?? null;
    return at !== null && at < meta.durationMs ? at : null;
  };
  const doc = {
    version: EVENTS_VERSION,
    timeBase: "engine ms on the frames' clock: frame n shows n * 1000 / fps; time held by a pause cue is included",
    fps: meta.fps,
    frames: meta.frames,
    durationMs: meta.durationMs,
    bpm: meta.bpm ?? null,
    count: events.length,
    soundLogSha256: sha256Hex(soundLogJson(events)),
    events: events.map((e, i) => ({ ...e, frame: frameOf(e.t), at: heardAt(i) })),
    scrolls: scrolls.map((s) => ({ ...s, frame: frameOf(s.t), endFrame: frameOf(s.end) })),
  };
  return `${JSON.stringify(doc, null, 1)}\n`;
}

/**
 * An argument value that names the input, a file the render writes, or a program it runs. The value
 * ends `argv[index]`, which is the value itself or an option with it inline (--output=take.mp4, -otake.mp4).
 */
export interface PathArg {
  index: number;
  value: string;
  kind: "input" | "file" | "program";
}

export interface ManifestInput {
  tool: { name: string; version: string };
  /**
   * Arguments after `swarmloom`, as given. The manifest records the values at {@link pathArgs} as
   * {@link shareableArg} does and redacts http(s) URLs in the rest.
   */
  argv: readonly string[];
  /** Where `argv` names the input, output files and programs (from the argument parser). */
  pathArgs: readonly PathArg[];
  /** Folder relative paths in `argv` are resolved against; not recorded. */
  cwd: string;
  /** Absolute path the manifest is written to; file paths are recorded relative to its folder. */
  manifestFile: string;
  input: { arg: string; kind: RenderSource["kind"]; name: string; format: string; sha256: string; bytes: number };
  info: RenderInfo;
  video: { format: OutputFormat; width: number; height: number; scale: number; fps: number };
  settings: PlayerSettings;
  fixedLength: boolean;
  maxDurationMs: number;
  cues: readonly ResolvedCue[];
  programs: {
    browser: { path: string; version: string };
    ffmpeg: { path: string; version: string } | null;
    playwrightCore: string | null;
    node: string;
    platform: string;
    arch: string;
  };
  fonts: readonly PlatformFont[] | null | undefined;
  result: {
    frames: number;
    durationMs: number;
    builtAtMs: number | null;
    finished: boolean;
    imageType: FrameImageType;
    frameSha256: readonly string[];
  };
  events: readonly SoundEvent[] | undefined;
  outputs: Record<string, { path: string; sha256: string; bytes: number }>;
}

/** Builds the --manifest-out document (pure; see {@link MANIFEST_VERSION}). */
export function buildManifest(m: ManifestInput): Record<string, unknown> {
  const { settings, result } = m;
  const dir = path.dirname(m.manifestFile);
  const argv = [...m.argv];
  for (const { index, value, kind } of m.pathArgs) {
    const arg = argv[index];
    if (!value || !arg?.endsWith(value)) continue;
    argv[index] = arg.slice(0, arg.length - value.length) + shareableArg(value, kind, m.cwd, dir);
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    tool: m.tool,
    argv: argv.map(redactUrl),
    input: {
      ...m.input,
      arg: shareableArg(m.input.arg, "input", m.cwd, dir),
      blueprintSha256: m.info.blueprintSha256 ?? null,
      layers: m.info.layers ?? null,
    },
    video: {
      ...m.video,
      pixels: [Math.round(m.video.width * m.video.scale), Math.round(m.video.height * m.video.scale)],
      length: m.fixedLength ? "fixed (--duration)" : "until done (--max-duration caps it)",
      maxDurationMs: m.maxDurationMs,
    },
    player: {
      ...settings,
      // The render page plays with the toolbar off (see @swarmloom/export).
      controls: false,
      intro: settings.intro ?? true,
      reducedMotion: settings.reducedMotion ?? false,
      beatSync: settings.beatSync ?? true,
    },
    cues: m.cues.map(({ spec, at, frame, action, speed }) =>
      speed === undefined ? { spec, atMs: at, frame, action } : { spec, atMs: at, frame, action, speed },
    ),
    programs: {
      ...m.programs,
      browser: programName(m.programs.browser),
      ffmpeg: m.programs.ffmpeg && programName(m.programs.ffmpeg),
    },
    fonts: m.fonts ?? null,
    frames: {
      count: result.frames,
      durationMs: result.durationMs,
      builtAtMs: result.builtAtMs,
      buildFinished: result.finished,
      imageType: result.imageType,
      hash: "sha256 of each screenshot as the browser encoded it, before ffmpeg",
      aggregateSha256: sha256Hex(result.frameSha256.join("\n")),
      sha256: result.frameSha256,
    },
    sound: m.events
      ? {
          bpm: settings.bpm ?? null,
          events: m.events.length,
          soundLogSha256: sha256Hex(soundLogJson(m.events)),
        }
      : null,
    outputs: Object.fromEntries(
      Object.entries(m.outputs).map(([name, out]) => [name, { ...out, path: shareablePath(dir, out.path) }]),
    ),
  };
}

/**
 * An http(s) URL without the parts that often carry secrets (user info, signed query strings, tokens
 * in the fragment): each present part becomes "redacted". Anything else comes back unchanged.
 */
export function redactUrl(arg: string): string {
  if (!isWebUrl(arg) || !URL.canParse(arg)) return arg;
  const url = new URL(arg);
  if (!url.username && !url.password && !url.search && !url.hash) return arg;
  if (url.username || url.password) {
    url.username = "redacted";
    url.password = "";
  }
  if (url.search) url.search = "redacted";
  if (url.hash) url.hash = "redacted";
  return url.href;
}

/**
 * A path argument as the manifest records it, given the folder `cwd` it was typed in and the
 * manifest's folder `dir`: programs by file name, http(s) URLs redacted, files (including the input as
 * a path or file: URL) by {@link shareablePath}.
 */
function shareableArg(value: string, kind: PathArg["kind"], cwd: string, dir: string): string {
  if (kind === "program") return path.basename(value);
  if (isWebUrl(value)) return redactUrl(value);
  return shareablePath(dir, kind === "input" ? inputFilePath(value, cwd) : path.resolve(cwd, value));
}

function programName(program: { path: string; version: string }): { name: string; version: string } {
  return { name: path.basename(program.path), version: program.version };
}

/**
 * `file` relative to the folder `dir` with "/" separators while that names no folder outside `dir`
 * (the file is inside it, or in a folder above it: "../take.mp4"). Otherwise the bare file name, so a
 * manifest in /tmp does not spell out "../home/<user>/<project>/take.mp4" (nor a path on another drive).
 */
function shareablePath(dir: string, file: string): string {
  const relative = path.relative(dir, file);
  if (relative === "") return ".";
  const parts = relative.split(path.sep);
  const firstName = parts.findIndex((part) => part !== "..");
  const leavesDir = firstName > 0 && firstName < parts.length - 1;
  return path.isAbsolute(relative) || leavesDir ? path.basename(file) : parts.join("/");
}

/** Writes `text` next to its destination first, then renames it into place. */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
