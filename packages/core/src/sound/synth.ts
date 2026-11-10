import { createRng } from "../rng";
import type { MasterBus } from "./bus";
import type { AdmittedEvent } from "./policy";
import { createNoiseBuffer, type Priority, type SoundPack, VoiceGroup, type VoiceHost, type VoiceSlot } from "./voice";

/** Most voices (event groups) sounding at once; beyond it the oldest lowest-priority voice is stolen. */
export const MAX_VOICES = 24;
/**
 * Mixer slots: one per voice plus spares for stolen voices that are still fading out while their
 * replacement starts.
 */
const SLOT_COUNT = MAX_VOICES + 8;

export interface SynthOptions {
  pack: SoundPack;
  bpm: number;
  /** Seed mixed with each event index for humanization. */
  seed: number;
}

/**
 * Builds the fixed mixer: a chain of unity gain stages per bus input, where stage i carries slot i
 * plus stage i + 1. A slot holds one sounding voice at a time, so every node input sums at most two
 * live signals and the mix is bit-exact regardless of the order the browser adds connections in.
 */
function createSlots(ctx: BaseAudioContext, bus: MasterBus): VoiceSlot[] {
  const slots: VoiceSlot[] = [];
  let dryNext: AudioNode = bus.input;
  let sendNext: AudioNode = bus.send;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const dry = ctx.createGain();
    const send = ctx.createGain();
    dry.connect(dryNext);
    send.connect(sendNext);
    slots.push({ dry, send });
    dryNext = dry;
    sendNext = send;
  }
  return slots;
}

/**
 * Turns admitted events into Web Audio graphs on one context (realtime or offline) and enforces
 * the voice cap. Identical inputs schedule identical graphs, which keeps offline renders
 * bit-identical across runs.
 */
export class Synth implements VoiceHost {
  readonly ctx: BaseAudioContext;
  readonly noise: AudioBuffer;
  readonly #options: SynthOptions;
  readonly #slots: readonly VoiceSlot[];
  /** Voice playing in each slot (possibly already finished), by slot index. */
  readonly #occupants: (VoiceGroup | null)[];
  /** Voices counted against {@link MAX_VOICES}: not finished and not stolen. */
  readonly #active: VoiceGroup[] = [];

  constructor(ctx: BaseAudioContext, bus: MasterBus, options: SynthOptions) {
    this.ctx = ctx;
    this.noise = createNoiseBuffer(ctx);
    this.#options = options;
    this.#slots = createSlots(ctx, bus);
    this.#occupants = this.#slots.map(() => null);
  }

  /**
   * Schedules `ev` to start at context time `time`.
   *
   * @returns false when the pack has no voice for it or the voice cap rejected it.
   */
  play(ev: AdmittedEvent, time: number): boolean {
    const voice = this.#options.pack.voices[ev.name];
    if (!voice || !this.#makeRoom(time, voice.priority)) return false;
    const slot = this.#occupants.findIndex((group) => group === null || group.end <= time);
    if (slot < 0) return false;
    const rng = createRng(eventSeed(this.#options.seed, ev.index));
    const group = new VoiceGroup(this, this.#slots[slot], time, voice, rng);
    voice.play(group, { time, pan: ev.pan, pitch: ev.pitch, vel: ev.vel, bpm: this.#options.bpm, rng });
    if (group.empty) {
      group.discard();
      return false;
    }
    this.#occupants[slot] = group;
    this.#active.push(group);
    return true;
  }

  /** Fades out and stops every voice still sounding at context time `at`. */
  stopAll(at: number): void {
    this.#prune(at);
    for (const group of this.#active) group.steal(at);
    this.#active.length = 0;
  }

  #prune(at: number): void {
    for (let i = this.#active.length - 1; i >= 0; i--) {
      if (this.#active[i].end <= at) this.#active.splice(i, 1);
    }
  }

  #makeRoom(at: number, priority: Priority): boolean {
    this.#prune(at);
    if (this.#active.length < MAX_VOICES) return true;
    let victim = -1;
    for (let i = 0; i < this.#active.length; i++) {
      const g = this.#active[i];
      if (g.priority > priority) continue;
      const best = victim < 0 ? undefined : this.#active[victim];
      if (!best || g.priority < best.priority || (g.priority === best.priority && g.start < best.start)) victim = i;
    }
    if (victim < 0) return false;
    this.#active[victim].steal(at);
    this.#active.splice(victim, 1);
    return true;
  }
}

/** Mixes the render seed with an event index into an independent 32-bit seed. */
export function eventSeed(seed: number, index: number): number {
  return (Math.imul(index + 1, 0x9e3779b1) ^ (seed >>> 0)) >>> 0;
}
