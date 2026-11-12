import type { SoundEvent } from "../types";
import { eighthMs, gridSlot, hitSlot, quantize } from "./quantize";
import { clamp } from "./scale";

/** A sound event that passed admission, with sanitized parameters and its start time. */
export interface AdmittedEvent {
  /** Position in the source sequence; keys the per-event PRNG so offline renders are repeatable. */
  readonly index: number;
  readonly name: string;
  /** Original engine time in ms. */
  readonly t: number;
  /** Engine time in ms at which the sound starts: `t`, or the next grid line for musical events. */
  readonly at: number;
  /** Stereo position -1..1. */
  readonly pan: number;
  /** Finite pitch or undefined; meaning depends on `name`. */
  readonly pitch: number | undefined;
  /** Velocity 0..1. */
  readonly vel: number;
}

export interface PolicyOptions {
  /** Tempo of the eighth-note grid. */
  readonly bpm: number;
  /** Quantize musical events (`note`, `fanout`, `chord`) to the grid. */
  readonly beatSync: boolean;
  /**
   * Also put hits (keys, clicks, snaps, pen anchors, heading ticks, pops) on the sixteenth-note
   * grid: each moves to a line at most {@link HIT_EARLY_MS} earlier or {@link HIT_LATE_MS} later,
   * one per sound name and line; a hit with no such line stays silent. Default false.
   */
  readonly beatHits?: boolean;
  /** Whether the active pack has a voice for `name`; unvoiced events are dropped. */
  readonly voiced: (name: string) => boolean;
}

/** Events that snap to the eighth-note grid when beat sync is on. */
const QUANTIZED: ReadonlySet<string> = new Set(["note", "fanout", "chord"]);
/** Phrase-level one-shots; an accidental repeat within {@link ONE_SHOT_GAP_MS} is dropped. */
const ONE_SHOTS: ReadonlySet<string> = new Set(["swell", "fanout", "chord", "sweep"]);
const ONE_SHOT_GAP_MS = 400;
/** Velocity of events that do not specify one. */
export const DEFAULT_VELOCITY = 0.8;
/** With beat hits, a hit may sound this much before its event (live playback schedules 30 ms ahead). */
export const HIT_EARLY_MS = 30;
/** With beat hits, a hit may sound this much after its event (late sound is the less noticeable). */
export const HIT_LATE_MS = 60;

interface RateLimit {
  readonly windowMs: number;
  readonly max: number;
}

/**
 * Caps for frequent mechanical sounds, so dozens of cursors typing at once stay a texture rather
 * than a wall of noise. Values are per category across all cursors.
 */
const RATE_LIMITS: Readonly<Record<string, RateLimit>> = {
  typing: { windowMs: 100, max: 6 },
  pointer: { windowMs: 100, max: 5 },
  tick: { windowMs: 100, max: 4 },
};

const CATEGORY: Readonly<Record<string, keyof typeof RATE_LIMITS>> = {
  key: "typing",
  space: "typing",
  press: "pointer",
  release: "pointer",
  pen: "pointer",
  snap: "pointer",
  pop: "pointer",
  tick: "tick",
};

/** Sliding window over the last `max` accepted times (ring buffer, no per-event allocation). */
class RateWindow {
  readonly #times: Float64Array;
  #next = 0;
  #count = 0;

  constructor(readonly limit: RateLimit) {
    this.#times = new Float64Array(limit.max);
  }

  tryTake(t: number): boolean {
    const { max, windowMs } = this.limit;
    // With a full ring, #next points at the oldest accepted time.
    if (this.#count === max && t - (this.#times[this.#next] ?? 0) < windowMs) return false;
    this.#times[this.#next] = t;
    this.#next = (this.#next + 1) % max;
    this.#count = Math.min(this.#count + 1, max);
    return true;
  }
}

/**
 * Decides which events sound and when. It is a pure function of the event sequence, shared by
 * realtime playback and offline rendering, which both feed it events in time order (ties in
 * emission order), so both make the same choices:
 *  - events without a voice in the pack, or with a non-finite time, are dropped;
 *  - musical events snap forward to the eighth-note grid ({@link quantize});
 *  - at most one `note` per grid slot: extra notes are dropped, never queued for later slots;
 *  - with beat hits, mechanical sounds move to a nearby sixteenth note, one per name and line, or drop;
 *  - mechanical sounds are rate-limited per category; phrase one-shots are de-duplicated.
 */
export class EventPolicy {
  readonly #options: PolicyOptions;
  readonly #windows = new Map<string, RateWindow>();
  readonly #lastOneShot = new Map<string, number>();
  /** Last sixteenth-note line a hit of each name took (beat hits). */
  readonly #lastHitSlot = new Map<string, number>();
  #lastNoteSlot = -1;

  constructor(options: PolicyOptions) {
    this.#options = options;
  }

  /**
   * @param ev Raw event as emitted by the engine (untrusted shape: values are sanitized).
   * @param index Position of the event in its sequence.
   * @returns The admitted event, or null when it must not sound.
   */
  admit(ev: SoundEvent, index: number): AdmittedEvent | null {
    const { name, t } = ev;
    if (typeof name !== "string" || typeof t !== "number" || !Number.isFinite(t)) return null;
    if (!this.#options.voiced(name)) return null;

    const { bpm, beatSync } = this.#options;
    let at = Math.max(0, t);
    if (beatSync && QUANTIZED.has(name)) at = quantize(at, bpm);

    if (name === "note") {
      // The slot of `at`, not of `t`: without beat sync notes still respect one per eighth.
      const slot = beatSync ? gridSlot(at, bpm) : Math.floor(at / eighthMs(bpm));
      if (slot <= this.#lastNoteSlot) return null;
      this.#lastNoteSlot = slot;
    } else if (ONE_SHOTS.has(name)) {
      const last = this.#lastOneShot.get(name);
      if (last !== undefined && at - last < ONE_SHOT_GAP_MS) return null;
      this.#lastOneShot.set(name, at);
    } else {
      const category = CATEGORY[name];
      if (category !== undefined) {
        if (this.#options.beatHits) {
          const slot = hitSlot(at, bpm, HIT_EARLY_MS, HIT_LATE_MS);
          if (slot < 0 || slot <= (this.#lastHitSlot.get(name) ?? -1)) return null;
          this.#lastHitSlot.set(name, slot);
          at = (slot * eighthMs(bpm)) / 2;
        }
        if (!this.#window(category).tryTake(at)) return null;
      }
    }

    return {
      index,
      name,
      t,
      at,
      pan: clamp(typeof ev.pan === "number" ? ev.pan : 0, -1, 1, 0),
      pitch: typeof ev.pitch === "number" && Number.isFinite(ev.pitch) ? ev.pitch : undefined,
      vel: clamp(typeof ev.vel === "number" ? ev.vel : DEFAULT_VELOCITY, 0, 1, DEFAULT_VELOCITY),
    };
  }

  #window(category: string): RateWindow {
    let win = this.#windows.get(category);
    if (!win) {
      win = new RateWindow(RATE_LIMITS[category] ?? { windowMs: 100, max: 4 });
      this.#windows.set(category, win);
    }
    return win;
  }
}
