import type { RenderOfflineOptions, SoundEvent } from "@swarmloom/core";
import { encodeWav, renderOffline } from "@swarmloom/core";

/**
 * Renders a sound event log to a WAV file aligned with exported frames.
 *
 * Thin wrapper over core `renderOffline` + `encodeWav`: event times are engine ms and map 1:1 to
 * audio time, so the soundtrack lines up with frames captured on the same virtual clock.
 *
 * @param events Usually `Player.soundLog` or `FrameExportResult.soundLog`.
 * @param durationMs Output length in ms (events after it are dropped).
 * @param opts Sample rate, channels and sound pack.
 * @returns Complete `.wav` bytes.
 * @throws RangeError for a zero, negative or non-finite duration.
 */
export async function renderAudioWav(
  events: readonly SoundEvent[],
  durationMs: number,
  opts?: RenderOfflineOptions,
): Promise<Uint8Array> {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a finite number > 0, got ${durationMs}`);
  }
  return encodeWav(await renderOffline(events, durationMs, opts));
}
