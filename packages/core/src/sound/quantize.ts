/** Default tempo of the musical grid, in beats per minute. */
export const DEFAULT_BPM = 112;
/** Slowest tempo accepted from options (slower values are clamped by the sound settings). */
export const MIN_BPM = 40;
/** Fastest tempo accepted from options (faster values are clamped by the sound settings). */
export const MAX_BPM = 240;

/**
 * Tolerance in ms for float noise: a time this close past a grid line still counts as on it, so a
 * grid time fed back into {@link quantize} maps to itself.
 */
const ON_GRID_MS = 1e-6;

function assertBpm(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError(`bpm must be a positive finite number, got ${bpm}`);
}

/**
 * Length of one eighth note at `bpm`.
 *
 * @param bpm Tempo in beats (quarter notes) per minute; must be positive and finite.
 * @returns Eighth-note duration in ms.
 * @throws RangeError when `bpm` is not a positive finite number.
 */
export function eighthMs(bpm: number): number {
  assertBpm(bpm);
  return 30000 / bpm;
}

/**
 * Index of the eighth-note slot that {@link quantize} snaps `tMs` to: slot `k` starts at
 * `k * eighthMs(bpm)`. Times at or before 0 map to slot 0.
 *
 * @throws TypeError when `tMs` is not finite; RangeError when `bpm` is invalid.
 */
export function gridSlot(tMs: number, bpm: number): number {
  if (!Number.isFinite(tMs)) throw new TypeError(`time must be a finite number of ms, got ${tMs}`);
  const step = eighthMs(bpm);
  // Math.max also turns a -0 from Math.ceil into +0.
  return Math.max(0, Math.ceil((tMs - ON_GRID_MS) / step));
}

/**
 * Snaps an engine time to the next line of the eighth-note grid of `bpm`, counted from t = 0.
 *
 * Pure and monotone (non-decreasing in `tMs`): realtime playback and offline export call it with
 * the same event times and therefore place every note on the same beat. A time already on the
 * grid stays where it is; any other time moves forward by less than one eighth note.
 *
 * @param tMs Engine time in ms.
 * @param bpm Tempo in beats per minute (the app default is {@link DEFAULT_BPM}).
 * @returns The quantized time in ms (>= 0).
 * @throws TypeError when `tMs` is not finite; RangeError when `bpm` is not positive and finite.
 */
export function quantize(tMs: number, bpm: number): number {
  return gridSlot(tMs, bpm) * eighthMs(bpm);
}
