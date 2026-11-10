import { createRng } from "../rng";
import type { Rng } from "../types";

/**
 * Voice priority for stealing when the voice cap is reached: a new voice may replace an older
 * voice of the same or lower priority, never a higher one.
 */
export const Priority = {
  /** Keys, clicks, ticks. */
  mechanical: 0,
  /** Placement notes. */
  note: 1,
  /** Phrase one-shots: swell, fan-out, chord, sweep. */
  phrase: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/** Parameters a pack voice receives for one admitted event. */
export interface VoiceParams {
  /** Context time in seconds at which the sound starts. */
  readonly time: number;
  readonly pan: number;
  readonly pitch: number | undefined;
  readonly vel: number;
  /** Tempo of the grid (arpeggio step lengths derive from it). */
  readonly bpm: number;
  /** Per-event PRNG for humanizing detune, levels and noise offsets. */
  readonly rng: Rng;
}

/** One sound of a pack. */
export interface PackVoice {
  readonly priority: Priority;
  /** Reverb send level 0..1: low for dry, close clicks, high for airy musical sounds. */
  readonly send: number;
  /** Mix fader: linear gain applied to the whole voice. Default 1. */
  readonly level?: number;
  /** Builds the sound inside `group`, starting at `params.time`. */
  play(group: VoiceGroup, params: VoiceParams): void;
}

/** A sound pack: event name -> voice. Names without a voice are silent in that pack. */
export interface SoundPack {
  readonly id: string;
  readonly voices: Readonly<Record<string, PackVoice | undefined>>;
}

/** Exponential sweep point: reach `freq` Hz at `offset` seconds after the sound starts. */
export type SweepPoint = readonly [offset: number, freq: number];

interface EnvelopeOptions {
  /** Absolute context time in seconds. */
  at: number;
  /** Peak linear gain. */
  gain: number;
  /** Seconds from silence to peak (minimum 0.5 ms to avoid onset clicks). */
  attack?: number;
  /** Seconds held at peak before the decay. */
  hold?: number;
  /** Seconds of exponential decay to -80 dB. */
  decay: number;
}

export interface NoiseOptions extends EnvelopeOptions {
  filter: BiquadFilterType;
  /** Filter frequency at the start. */
  freq: number;
  q?: number;
  /** Optional exponential filter sweep. */
  sweep?: readonly SweepPoint[];
}

export interface ToneOptions extends EnvelopeOptions {
  type: OscillatorType;
  freq: number;
  /** Optional exponential pitch sweep. */
  sweep?: readonly SweepPoint[];
  /** Fine detune in cents. */
  detune?: number;
  /** Optional lowpass cutoff in Hz to soften bright waveforms. */
  lowpass?: number;
}

/** Partials and filters above this are skipped (inaudible for most listeners, alias-prone). */
export const MAX_PARTIAL_HZ = 14000;
/** Fade applied to a stolen voice, in seconds. */
const STEAL_FADE = 0.02;
/** Envelopes decay exponentially to this fraction of the peak (-80 dB)... */
const DECAY_FLOOR = 1e-4;
/** ...then ramp linearly to exactly 0 over this many seconds. */
const SILENCE_RAMP = 0.002;
/** Sources stop this long after their envelope reached 0 (filters settle on a zero input). */
const STOP_MARGIN = 0.01;
/** Stereo width: events at the screen edge sit at 80% left/right, never hard-panned. */
const PAN_WIDTH = 0.8;
const NOISE_SEED = 0x6e01;
const NOISE_SECONDS = 1;

/** One second of seeded white noise, looped by noise voices at random offsets. */
export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = createRng(NOISE_SEED);
  for (let i = 0; i < length; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

/**
 * Schedules attack / hold / exponential decay on `param`, ending at exactly 0; returns the time the
 * gain reaches 0. Ending on true silence matters for determinism: nodes are disconnected from the
 * main thread at a moment that varies between runs, which must not change a single sample.
 */
function envelope(param: AudioParam, o: EnvelopeOptions): number {
  const attack = Math.max(0.0005, o.attack ?? 0.001);
  const hold = Math.max(0, o.hold ?? 0);
  const peakAt = o.at + attack;
  const decayEnd = peakAt + hold + Math.max(0.002, o.decay);
  param.setValueAtTime(0, o.at);
  param.linearRampToValueAtTime(o.gain, peakAt);
  if (hold > 0) param.setValueAtTime(o.gain, peakAt + hold);
  param.exponentialRampToValueAtTime(o.gain * DECAY_FLOOR, decayEnd);
  param.linearRampToValueAtTime(0, decayEnd + SILENCE_RAMP);
  return decayEnd + SILENCE_RAMP;
}

function applySweep(param: AudioParam, at: number, start: number, sweep: readonly SweepPoint[] | undefined): void {
  param.setValueAtTime(start, at);
  if (!sweep) return;
  for (const [offset, freq] of sweep) {
    param.exponentialRampToValueAtTime(Math.max(1, freq), at + Math.max(0.001, offset));
  }
}

/**
 * Sums any number of signals into one node so that no node input ever mixes more than two of them.
 *
 * Chromium adds the connections of one input in an order that varies between runs (it follows
 * memory addresses). With three or more operands float addition then rounds differently from run
 * to run; with two it is exact in either order. Each added signal therefore gets a unity gain
 * stage that also carries the stages added after it: dest <- s1 + stage2, stage2 <- s2 + stage3...
 */
export class Junction {
  readonly #ctx: BaseAudioContext;
  readonly #dest: AudioNode;
  readonly #own: <T extends AudioNode>(node: T) => T;
  #head: AudioNode | null = null;
  #empty = true;

  constructor(ctx: BaseAudioContext, dest: AudioNode, own: <T extends AudioNode>(node: T) => T) {
    this.#ctx = ctx;
    this.#dest = dest;
    this.#own = own;
  }

  /** Connects `node` into the sum. */
  add(node: AudioNode): void {
    if (this.#empty) {
      this.#empty = false;
      node.connect(this.#dest);
      return;
    }
    const stage = this.#own(this.#ctx.createGain());
    node.connect(stage);
    stage.connect(this.#head ?? this.#dest);
    this.#head = stage;
  }
}

/** What a voice group needs from its synth. */
export interface VoiceHost {
  readonly ctx: BaseAudioContext;
  /** Shared looped noise source material. */
  readonly noise: AudioBuffer;
}

/** Where a voice group plays: a dry input of the master mix and a reverb send input. */
export interface VoiceSlot {
  readonly dry: AudioNode;
  readonly send: AudioNode;
}

/**
 * The nodes of one admitted event. Pack voices add sources through it; the group owns every node
 * it creates and disconnects them all once its last source has ended (never earlier, so long
 * partials are not cut off by short ones).
 */
export class VoiceGroup {
  readonly priority: Priority;
  readonly start: number;
  #end: number;
  readonly #host: VoiceHost;
  readonly #rng: Rng;
  readonly #level: number;
  readonly #output: GainNode;
  readonly #mix: Junction;
  readonly #nodes: AudioNode[] = [];
  readonly #sources: AudioScheduledSourceNode[] = [];
  #live = 0;

  constructor(host: VoiceHost, slot: VoiceSlot, start: number, voice: PackVoice, rng: Rng) {
    this.#host = host;
    this.start = start;
    this.#end = start;
    this.priority = voice.priority;
    this.#level = voice.level ?? 1;
    this.#rng = rng;
    const { ctx } = host;
    this.#output = this.#own(ctx.createGain());
    this.#output.gain.value = this.#level;
    this.#output.connect(slot.dry);
    if (voice.send > 0) {
      const sendGain = this.#own(ctx.createGain());
      sendGain.gain.value = voice.send;
      this.#output.connect(sendGain).connect(slot.send);
    }
    this.#mix = new Junction(ctx, this.#output, this.#own);
  }

  /** Context time at which the last source of the group stops. */
  get end(): number {
    return this.#end;
  }

  get empty(): boolean {
    return this.#sources.length === 0;
  }

  /** A stereo-positioned input inside the group; `pan` is -1..1 (scaled to the pack width). */
  out(pan: number): Junction {
    const { ctx } = this.#host;
    // StereoPannerNode is missing in Safari < 14.1; those builds play centred.
    if (typeof ctx.createStereoPanner !== "function") return this.#mix;
    const panner = this.#own(ctx.createStereoPanner());
    panner.pan.value = pan * PAN_WIDTH;
    this.#mix.add(panner);
    return new Junction(ctx, panner, this.#own);
  }

  /** Filtered noise burst or sweep (clicks, thocks, air). */
  noise(dest: Junction, o: NoiseOptions): void {
    if (!(o.gain > 0)) return;
    const { ctx, noise } = this.#host;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = this.#own(ctx.createBiquadFilter());
    filter.type = o.filter;
    filter.Q.value = o.q ?? 1;
    applySweep(filter.frequency, o.at, Math.min(o.freq, MAX_PARTIAL_HZ), o.sweep);
    const amp = this.#own(ctx.createGain());
    const end = envelope(amp.gain, o);
    src.connect(filter).connect(amp);
    dest.add(amp);
    src.start(o.at, this.#rng() * NOISE_SECONDS);
    this.#track(src, end);
  }

  /** Oscillator with an envelope (partials, thocks, pads, chiptune). */
  tone(dest: Junction, o: ToneOptions): void {
    if (!(o.gain > 0) || o.freq > MAX_PARTIAL_HZ) return;
    const { ctx } = this.#host;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    applySweep(osc.frequency, o.at, o.freq, o.sweep);
    if (o.detune) osc.detune.value = o.detune;
    const amp = this.#own(ctx.createGain());
    const end = envelope(amp.gain, o);
    let head: AudioNode = osc;
    if (o.lowpass !== undefined) {
      const filter = this.#own(ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = Math.min(o.lowpass, MAX_PARTIAL_HZ);
      head = head.connect(filter);
    }
    head.connect(amp);
    dest.add(amp);
    osc.start(o.at);
    this.#track(osc, end);
  }

  /** Fades the whole group out quickly from `at` (voice stealing, mute). */
  steal(at: number): void {
    if (at >= this.#end) return;
    const gain = this.#output.gain;
    gain.setValueAtTime(this.#level, at);
    gain.linearRampToValueAtTime(0, at + STEAL_FADE);
    const stopAt = at + STEAL_FADE + 0.005;
    for (const src of this.#sources) {
      try {
        src.stop(stopAt);
      } catch {
        // Older WebKit throws on a second stop(); the source then ends at its original time.
      }
    }
    this.#end = Math.min(this.#end, stopAt);
  }

  /** Disconnects a group that ended up with no sources. */
  discard(): void {
    this.#release();
  }

  readonly #own = <T extends AudioNode>(node: T): T => {
    this.#nodes.push(node);
    return node;
  };

  /** Registers a started source: stops it after its envelope and releases the group after the last one. */
  #track(src: AudioScheduledSourceNode, end: number): void {
    this.#nodes.push(src);
    this.#sources.push(src);
    this.#live++;
    src.onended = () => {
      if (--this.#live === 0) this.#release();
    };
    const stopAt = end + STOP_MARGIN;
    src.stop(stopAt);
    if (stopAt > this.#end) this.#end = stopAt;
  }

  #release(): void {
    for (const node of this.#nodes) node.disconnect();
    this.#nodes.length = 0;
  }
}
