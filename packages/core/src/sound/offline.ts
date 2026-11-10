import type { SoundEvent, SoundOptions } from "../types";

export interface RenderOfflineOptions {
  /** Output sample rate in Hz. Default 48000. */
  sampleRate?: number;
  /** Output channels (1 or 2). Default 2. */
  channels?: number;
  /** Sound pack, volume and tempo, same meaning as `PlayerOptions.sound`. */
  sound?: SoundOptions;
}

/**
 * Renders a recorded sound event log to audio with an `OfflineAudioContext`.
 *
 * Used by exports so the soundtrack matches the frames exactly: event `t` values are engine ms
 * and map 1:1 to audio time.
 *
 * @param events Sound events, usually `Player.soundLog`.
 * @param durationMs Length of the output in ms; events after it are dropped.
 * @param opts Sample rate, channel count and sound pack.
 * @returns The rendered buffer.
 * @throws Error "not implemented yet" until the sound module lands.
 */
export async function renderOffline(
  events: readonly SoundEvent[],
  durationMs: number,
  opts?: RenderOfflineOptions,
): Promise<AudioBuffer> {
  void events;
  void durationMs;
  void opts;
  throw new Error("not implemented yet");
}

/**
 * Encodes an `AudioBuffer` as a 16-bit PCM RIFF/WAVE file.
 *
 * @param buffer Audio to encode (all channels, interleaved in the output).
 * @returns The complete `.wav` file bytes.
 * @throws Error "not implemented yet" until the sound module lands.
 */
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  void buffer;
  throw new Error("not implemented yet");
}
