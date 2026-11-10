import type { Rng } from "../../types";
import { eighthMs } from "../quantize";
import { hz } from "../scale";
import { type Junction, MAX_PARTIAL_HZ, type VoiceGroup, type VoiceParams } from "../voice";

/** Random factor in [1 - amount, 1 + amount] for humanizing frequencies and levels. */
export function vary(rng: Rng, amount: number): number {
  return 1 + (rng() * 2 - 1) * amount;
}

/** Length of a sixteenth note at the event's tempo, in seconds. */
export function sixteenth(p: VoiceParams): number {
  return eighthMs(p.bpm) / 2000;
}

/** Linear spread of `count` positions from `from` to `to` (inclusive). */
export function spread(index: number, count: number, from: number, to: number): number {
  return count <= 1 ? (from + to) / 2 : from + ((to - from) * index) / (count - 1);
}

export interface StruckOptions {
  at: number;
  semitone: number;
  gain: number;
  /** Decay of the fundamental in seconds; overtones decay faster. */
  decay: number;
}

/**
 * Glass bell: a sine fundamental with a few slightly inharmonic overtones (the "glass" colour),
 * each fading faster than the one below, plus a short bright mallet tap. Detune is a few cents of
 * seeded randomness per partial so repeated notes never sound sampled.
 */
export function glassBell(g: VoiceGroup, dest: Junction, rng: Rng, o: StruckOptions): void {
  const f = hz(o.semitone);
  const partials: readonly (readonly [ratio: number, level: number, decayScale: number])[] = [
    [1, 1, 1],
    [2.01, 0.32, 0.55],
    [3.03, 0.16, 0.36],
    [5.43, 0.07, 0.2],
  ];
  for (const [ratio, level, decayScale] of partials) {
    const freq = f * ratio;
    if (freq > MAX_PARTIAL_HZ) break;
    g.tone(dest, {
      at: o.at,
      type: "sine",
      freq,
      detune: (rng() * 2 - 1) * 3,
      gain: o.gain * level,
      attack: 0.002,
      decay: o.decay * decayScale,
    });
  }
  g.noise(dest, {
    at: o.at,
    filter: "bandpass",
    freq: Math.min(f * 4, 9000),
    q: 2.5,
    gain: o.gain * 0.18,
    attack: 0.0008,
    decay: 0.025,
  });
}

/**
 * Felt-mallet marimba: a round fundamental with the bar's characteristic 4x and 10x overtones
 * that die out almost immediately, and a soft low-passed mallet thump.
 */
export function marimba(g: VoiceGroup, dest: Junction, rng: Rng, o: StruckOptions): void {
  const f = hz(o.semitone);
  g.tone(dest, {
    at: o.at,
    type: "sine",
    freq: f,
    detune: (rng() * 2 - 1) * 2,
    gain: o.gain,
    attack: 0.003,
    decay: o.decay,
  });
  g.tone(dest, { at: o.at, type: "sine", freq: f * 3.99, gain: o.gain * 0.22, attack: 0.001, decay: 0.07 });
  g.tone(dest, { at: o.at, type: "sine", freq: f * 9.95, gain: o.gain * 0.05, attack: 0.001, decay: 0.025 });
  g.noise(dest, { at: o.at, filter: "lowpass", freq: 1100, q: 0.7, gain: o.gain * 0.12, attack: 0.001, decay: 0.018 });
}

export interface PadOptions {
  at: number;
  semitones: readonly number[];
  type: OscillatorType;
  /** Gain of each pad tone. */
  gain: number;
  attack: number;
  hold: number;
  decay: number;
  /** Seconds between the entries of successive tones. */
  stagger?: number;
  lowpass?: number;
}

/** Soft sustained tones entering one after another (drones under the swell and the chord). */
export function pad(g: VoiceGroup, dest: Junction, rng: Rng, o: PadOptions): void {
  o.semitones.forEach((semitone, i) => {
    g.tone(dest, {
      at: o.at + i * (o.stagger ?? 0),
      type: o.type,
      freq: hz(semitone),
      detune: (rng() * 2 - 1) * 4,
      gain: o.gain,
      attack: o.attack,
      hold: o.hold,
      decay: o.decay,
      lowpass: o.lowpass,
    });
  });
}

/** Decay of a struck note by register: low notes ring longer than high ones. */
export function registerDecay(semitone: number, low: number, high: number): number {
  const t = Math.min(1, Math.max(0, semitone / 36));
  return low + (high - low) * t;
}
