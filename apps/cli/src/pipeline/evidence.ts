/**
 * Capture evidence for `render --audio-out/--events-out/--manifest-out`: the soundtrack WAV, the
 * sound events on video time, and a manifest that pins everything needed to reproduce and verify a
 * render (input and blueprint hashes, settings, cues, program versions, fonts, per-frame hashes).
 *
 * Nothing here depends on wall-clock time, so two renders with the same arguments on the same
 * machine produce the same events file and the same manifest apart from output paths.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SoundEvent } from "@swarmloom/core";
import type { PlatformFont } from "./driver";
import type { FrameImageType, OutputFormat } from "./encode";
import type { RenderSource } from "./input";
import type { RenderCue, RenderInfo } from "./protocol";
import type { PlayerSettings } from "./render";

/** Bumped when a field changes meaning; readers must check it. */
export const MANIFEST_VERSION = 1;
/** Bumped when the events file changes shape. */
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
 * The --events-out document: the sound log plus the nearest frame of each event. Event times are
 * when the engine raised them; with --bpm, "note", "fanout" and "chord" sound at the next eighth note.
 */
export function eventsDocument(
  events: readonly SoundEvent[],
  meta: { fps: number; frames: number; durationMs: number; bpm?: number },
): string {
  const doc = {
    version: EVENTS_VERSION,
    timeBase: "engine ms on the frames' clock: frame n shows n * 1000 / fps; time held by a pause cue is included",
    fps: meta.fps,
    frames: meta.frames,
    durationMs: meta.durationMs,
    bpm: meta.bpm ?? null,
    count: events.length,
    soundLogSha256: sha256Hex(soundLogJson(events)),
    events: events.map((e) => ({ ...e, frame: Math.round((e.t * meta.fps) / 1000) })),
  };
  return `${JSON.stringify(doc, null, 1)}\n`;
}

export interface ManifestInput {
  tool: { name: string; version: string };
  /** Arguments after `swarmloom`, as given. */
  argv: readonly string[];
  cwd: string;
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
  return {
    manifestVersion: MANIFEST_VERSION,
    tool: m.tool,
    argv: m.argv,
    cwd: m.cwd,
    input: { ...m.input, blueprintSha256: m.info.blueprintSha256 ?? null, layers: m.info.layers ?? null },
    video: {
      ...m.video,
      pixels: [Math.round(m.video.width * m.video.scale), Math.round(m.video.height * m.video.scale)],
      length: m.fixedLength ? "fixed (--duration)" : "until done (--max-duration caps it)",
      maxDurationMs: m.maxDurationMs,
    },
    player: {
      ...settings,
      // The render page always plays the intro with the toolbar off (see @swarmloom/export).
      controls: false,
      intro: true,
      reducedMotion: settings.reducedMotion ?? false,
      beatSync: true,
    },
    cues: m.cues.map(({ spec, at, frame, action }) => ({ spec, atMs: at, frame, action })),
    programs: m.programs,
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
    outputs: m.outputs,
  };
}

/** Writes `text` next to its destination first, then renames it into place. */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
