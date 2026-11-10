import { createRng } from "../rng";
import { clamp } from "./scale";

/** Master volume used when options leave it out. */
export const DEFAULT_VOLUME = 0.8;
/**
 * Time constant of mute/unmute and volume changes, in seconds. `setTargetAtTime` approaches the
 * target exponentially from whatever value the gain has at that moment, so toggling mid-ramp
 * stays continuous (no clicks); the gain is within -60 dB of the target after ~7 constants.
 */
export const MUTE_TIME_CONSTANT = 0.015;

/** Headroom before the compressor so a dozen simultaneous voices rarely hit it hard. */
const INPUT_GAIN = 0.7;
/** Level of the reverb return relative to the dry signal. */
const WET_GAIN = 0.55;
/** Fixed seed of the generated room so every render (realtime or offline) uses the same space. */
const ROOM_SEED = 0x51a7;
const ROOM_SECONDS = 1.3;
const ROOM_PREDELAY_SECONDS = 0.006;
/** Output ceiling of the limiter: -1 dBFS, the EBU R128 peak limit. */
export const LIMIT_CEILING = 10 ** (-1 / 20);
/** Below this level (-3.1 dBFS) the limiter passes samples unchanged. */
export const LIMIT_KNEE = 0.7;
const LIMIT_CURVE_POINTS = 4097;

export interface MasterBusOptions {
  /** 0..1, mapped to gain with a square-law curve (perceptually even steps). */
  volume: number;
  /** Start muted (gain 0) instead of audible. */
  muted: boolean;
  /** Where the bus plays; default `ctx.destination`. */
  destination?: AudioNode;
}

/**
 * Shared output stage of every voice:
 *
 *   input ─────────────────────┐
 *   send ─> room convolver ─> wet ─┴─> compressor ─> volume ─> limiter ─> mute ─> destination
 *                                          └─> tap (analysis, independent of volume and mute)
 *
 * The limiter is a soft ceiling after the master volume: transparent up to {@link LIMIT_KNEE},
 * then a smooth (tanh) knee that keeps every sample below {@link LIMIT_CEILING} (-1 dBFS) even
 * when many loud voices coincide at full volume.
 */
export interface MasterBus {
  /** Dry input; voices connect their panned output here. */
  readonly input: AudioNode;
  /** Reverb send; voices connect a scaled copy here for room ambience. */
  readonly send: AudioNode;
  /** Compressed mix before volume and mute, for level analysis (the halo reacts the same at any volume). */
  readonly tap: AudioNode;
  /** Smoothly changes the master volume starting at context time `at`. */
  setVolume(volume: number, at: number): void;
  /** Smoothly fades the output out or back in starting at context time `at`. */
  setMuted(muted: boolean, at: number): void;
  /** Disconnects the bus from its destination. */
  disconnect(): void;
}

/** Square-law volume curve: 0.5 is about half as loud as 1 (-12 dB). */
export function volumeGain(volume: number): number {
  const v = clamp(volume, 0, 1, DEFAULT_VOLUME);
  return v * v;
}

/**
 * Generates a short, slightly dark stereo room impulse: a few early reflections followed by a
 * decorrelated noise tail that decays by 60 dB over {@link ROOM_SECONDS} and loses its highs as
 * it fades. Deterministic for a given sample rate.
 */
export function createRoomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.ceil(rate * ROOM_SECONDS);
  const predelay = Math.round(rate * ROOM_PREDELAY_SECONDS);
  const impulse = ctx.createBuffer(2, length, rate);
  const rng = createRng(ROOM_SEED);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    // Early reflections: sparse taps in the first ~45 ms, quieter as they arrive later.
    for (let k = 0; k < 6; k++) {
      const at = predelay + Math.floor(rng() * rate * 0.045);
      if (at < length) data[at] = (rng() < 0.5 ? -1 : 1) * (0.7 - k * 0.08);
    }
    let lowpassed = 0;
    for (let i = predelay; i < length; i++) {
      const progress = (i - predelay) / (length - predelay);
      const envelope = 10 ** (-3 * progress); // -60 dB at the end
      // One-pole lowpass whose cutoff falls over time: the tail darkens like a real room.
      const coefficient = 0.85 - 0.75 * progress;
      lowpassed += coefficient * (rng() * 2 - 1 - lowpassed);
      data[i] = (data[i] ?? 0) + lowpassed * envelope * 0.5;
    }
  }
  return impulse;
}

/**
 * Transfer curve of the limiter over inputs -1..1 (a WaveShaperNode clamps louder inputs to the
 * end points): identity up to {@link LIMIT_KNEE}, then a tanh knee with slope 1 at the knee that
 * approaches {@link LIMIT_CEILING} without reaching it. Odd-symmetric and monotone.
 */
export function createLimiterCurve(points = LIMIT_CURVE_POINTS): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const room = LIMIT_CEILING - LIMIT_KNEE;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const level = Math.abs(x);
    const y = level <= LIMIT_KNEE ? level : LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Builds the master bus on `ctx` (realtime or offline). */
export function createMasterBus(ctx: BaseAudioContext, options: MasterBusOptions): MasterBus {
  const input = ctx.createGain();
  input.gain.value = INPUT_GAIN;
  const send = ctx.createGain();
  const room = ctx.createConvolver();
  room.buffer = createRoomImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = WET_GAIN;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 10;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const volume = ctx.createGain();
  volume.gain.value = volumeGain(options.volume);
  const limiter = ctx.createWaveShaper();
  limiter.curve = createLimiterCurve();
  const mute = ctx.createGain();
  mute.gain.value = options.muted ? 0 : 1;

  input.connect(compressor);
  send.connect(room).connect(wet).connect(compressor);
  compressor
    .connect(volume)
    .connect(limiter)
    .connect(mute)
    .connect(options.destination ?? ctx.destination);

  return {
    input,
    send,
    tap: compressor,
    setVolume(value, at) {
      volume.gain.setTargetAtTime(volumeGain(value), at, MUTE_TIME_CONSTANT);
    },
    setMuted(muted, at) {
      mute.gain.setTargetAtTime(muted ? 0 : 1, at, MUTE_TIME_CONSTANT);
    },
    disconnect() {
      mute.disconnect();
    },
  };
}
