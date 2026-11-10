/**
 * Musical material shared by every pack. SwarmLoom plays in A major pentatonic: any order of
 * placements stays consonant, and the key sits comfortably for bell-like timbres.
 */

/** Semitone offsets of the major pentatonic scale degrees from the root. */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];
/** Frequency of semitone 0 (A3). Every semitone value below is relative to it. */
export const ROOT_HZ = 220;
/** Number of octaves the `note` pitch (0..1) spreads over: low, middle and high register. */
export const REGISTERS = 3;

/** Completion chord: A add9, spread from A2 up to A5 so it strums across the stereo field. */
export const CHORD: readonly number[] = [-12, -5, 0, 4, 7, 14, 16, 19, 24];
/** Fan-out arpeggio: one rising octave of the scale, A4 to A5. */
export const ARPEGGIO: readonly number[] = [12, 14, 16, 19, 21, 24];
/** Soft drone under the opening swell and the completion chord: A2, E3, A3. */
export const DRONE: readonly number[] = [-12, -5, 0];

/** Clamps to [lo, hi]; NaN maps to `fallback`. */
export function clamp(value: number, lo: number, hi: number, fallback = lo): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, lo), hi);
}

/** Frequency in Hz of a semitone offset from {@link ROOT_HZ}. */
export function hz(semitone: number): number {
  return ROOT_HZ * 2 ** (semitone / 12);
}

/**
 * Semitone of a placement note.
 *
 * `pitch` 0..1 picks the register (higher pitch, higher register; callers pass
 * `1 - normalizedArea` so small elements ring high and large blocks low) and `pan` -1..1 (the
 * cursor's x) picks the scale degree, so melodies rise from left to right.
 *
 * @param pitch Register selector 0..1; missing or NaN means the middle register.
 * @param pan Horizontal position -1..1; NaN means the centre.
 */
export function noteSemitone(pitch: number | undefined, pan: number): number {
  const p = clamp(pitch ?? 0.5, 0, 1, 0.5);
  const register = Math.min(REGISTERS - 1, Math.floor(p * REGISTERS));
  const x = (clamp(pan, -1, 1, 0) + 1) / 2;
  const degree = Math.min(PENTATONIC.length - 1, Math.floor(x * PENTATONIC.length));
  return register * 12 + (PENTATONIC[degree] ?? 0);
}

/**
 * Semitone of the n-th step of a rising scale run (heading growth ticks): walks the pentatonic
 * scale upward from A4, wrapping into higher octaves, capped at two octaves.
 */
export function stepSemitone(step: number | undefined): number {
  const n = Math.floor(clamp(step ?? 0, 0, PENTATONIC.length * 2, 0));
  const octave = Math.floor(n / PENTATONIC.length);
  return 12 + octave * 12 + (PENTATONIC[n % PENTATONIC.length] ?? 0);
}
