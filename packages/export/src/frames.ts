import type { PlayerOptions, SoundEvent } from "@swarmloom/core";
import { ENGINE_TICK_RATE, RenderSession } from "./session";

/** Options for {@link exportFrames}. */
export interface FrameExportOptions {
  /** Frames per second (1..240); frame `n` shows engine time `n * 1000 / fps`. */
  fps: number;
  /** Stop after this much engine time even if the build is not done. Default 600000 (10 min). */
  maxDurationMs?: number;
  /** Keep exporting this long after the build completes (finale), ms. Default 0. */
  tailMs?: number;
  /** Called once per frame after its assets are ready; capture the stage here (screenshot, canvas read, encoder). */
  onFrame(index: number, timeMs: number): void | Promise<void>;
  /** Called for each recoverable player error (see `RenderSessionOptions.onWarning`); throw to abort. */
  onWarning?: (error: Error) => void;
  signal?: AbortSignal;
}

/** What {@link exportFrames} produced. */
export interface FrameExportResult {
  frames: number;
  /** Video length: `frames * 1000 / fps`. */
  durationMs: number;
  /**
   * Sound events of the whole video, the last frame's interval included, ready for
   * `renderAudioWav(soundLog, durationMs)`.
   */
  soundLog: readonly SoundEvent[];
  /** Recoverable errors the player reported during the run (skipped layers, failed tasks). */
  warnings: readonly Error[];
}

const DEFAULT_MAX_DURATION = 600_000;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Plays a blueprint on a `VirtualClock`, one frame at a time, for deterministic video export.
 *
 * Frame 0 is the first frame of the intro (t = 0). Frame times are computed from the frame index,
 * not accumulated, so long exports do not drift. The engine ticks 120 times a second whatever the
 * frame rate, so rates that divide 120 (24, 30, 60, ...) show the same build. The player is created with `controls: false`
 * unless the options say otherwise, and is destroyed when the export ends or fails.
 *
 * @param options Player options; the clock is supplied by the exporter.
 * @param frames Frame rate, limits and the per-frame capture callback.
 * @throws RangeError for an invalid fps or limit; whatever `onFrame` or `onWarning` throws or
 *   `play()` rejects with; the signal's reason when aborted. Recoverable player errors do not throw.
 */
export async function exportFrames(
  options: Omit<PlayerOptions, "clock">,
  frames: FrameExportOptions,
): Promise<FrameExportResult> {
  const { fps, signal } = frames;
  const maxDuration = frames.maxDurationMs ?? DEFAULT_MAX_DURATION;
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new RangeError(`fps must be within 1..240, got ${fps}`);
  if (!(maxDuration > 0) || !Number.isFinite(maxDuration)) {
    throw new RangeError(`maxDurationMs must be a positive finite number, got ${maxDuration}`);
  }
  throwIfAborted(signal);

  const session = new RenderSession({
    player: { controls: false, ...options },
    tailMs: frames.tailMs,
    onWarning: frames.onWarning,
    tickRate: ENGINE_TICK_RATE,
  });
  try {
    await session.start();
    let index = 0;
    for (;;) {
      throwIfAborted(signal);
      await frames.onFrame(index, session.elapsed);
      const next = ((index + 1) * 1000) / fps;
      if (session.status().done || next > maxDuration) break;
      index++;
      await session.step(next - session.elapsed);
    }
    const count = index + 1;
    const durationMs = (count * 1000) / fps;
    // The last frame stays up until durationMs. Run the clock through that interval too (nothing is
    // captured) so the sounds raised in it are logged, and frame rates that divide the tick rate get
    // one soundtrack.
    await session.step(durationMs - session.elapsed);
    return {
      frames: count,
      durationMs,
      soundLog: [...session.soundLog],
      warnings: [...session.warnings],
    };
  } finally {
    session.dispose();
  }
}
