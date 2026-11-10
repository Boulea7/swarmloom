import type { PlayerOptions, RenderOfflineOptions, SoundEvent } from "@swarmloom/core";
import { encodeWav, renderOffline } from "@swarmloom/core";

export interface FrameExportOptions {
  /** Frames per second; each frame advances the virtual clock by 1000 / fps ms. */
  fps: number;
  /** Stop after this much engine time even if the build is not done. Default: until done. */
  maxDurationMs?: number;
  /** Called after each frame is laid out; capture the stage here (screenshot, canvas read, encoder). */
  onFrame(index: number, timeMs: number): void | Promise<void>;
  signal?: AbortSignal;
}

export interface FrameExportResult {
  frames: number;
  durationMs: number;
  /** Sound events of the run, ready for {@link renderAudioWav}. */
  soundLog: readonly SoundEvent[];
}

/**
 * Plays a blueprint on a `VirtualClock`, one frame at a time, for deterministic video export.
 *
 * @param options Player options; the clock is supplied by the exporter.
 * @param frames Frame rate, length limit and per-frame capture callback.
 * @throws Error "not implemented yet" until the exporter lands.
 */
export async function exportFrames(
  options: Omit<PlayerOptions, "clock">,
  frames: FrameExportOptions,
): Promise<FrameExportResult> {
  void options;
  void frames;
  throw new Error("not implemented yet");
}

/**
 * Renders a sound event log to a WAV file aligned with exported frames.
 *
 * @param events Usually `FrameExportResult.soundLog` or `Player.soundLog`.
 * @param durationMs Output length in ms.
 * @param opts Sample rate, channels and sound pack.
 * @returns Complete `.wav` bytes.
 */
export async function renderAudioWav(
  events: readonly SoundEvent[],
  durationMs: number,
  opts?: RenderOfflineOptions,
): Promise<Uint8Array> {
  return encodeWav(await renderOffline(events, durationMs, opts));
}

export interface RecordOptions {
  /** Container/codec, e.g. "video/webm;codecs=vp9". Default: best supported. */
  mimeType?: string;
  fps?: number;
  videoBitsPerSecond?: number;
  /** Audio track to mux in (for example a WebAudio destination stream). */
  audio?: MediaStream;
}

export interface Recording {
  readonly mimeType: string;
  /** Stops recording and resolves with the encoded video. */
  stop(): Promise<Blob>;
}

/**
 * Records a live element in real time (Region Capture + MediaRecorder, or WebCodecs where available).
 *
 * @param target Element to record, usually the player host.
 * @param opts Codec, frame rate, bitrate and optional audio track.
 * @throws Error "not implemented yet" until the recorder lands.
 */
export async function recordElement(target: Element, opts?: RecordOptions): Promise<Recording> {
  void target;
  void opts;
  throw new Error("not implemented yet");
}
