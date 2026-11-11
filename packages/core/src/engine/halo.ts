import type { OverlayHandle, Rect, StageApi } from "../types";
import type { Agent } from "./agent";
import { clamp } from "./easing";
import { steerTo } from "./steer";

/** Number of spectrum bands published to the halo overlay. */
export const HALO_BANDS = 16;
/** Outer ring radius as a share of the smaller viewport side. */
const OUTER_SHARE = 0.42;
const TWO_RING_RADII: readonly number[] = [0.62, 1];
const THREE_RING_RADII: readonly number[] = [0.5, 0.75, 1];
/** Up to this many agents use two rings, more use three. */
const TWO_RING_MAX = 12;
/** Rotation speed: base plus mid-band drive, rad/s. Rings alternate direction. */
const SPIN_BASE = 0.22;
const SPIN_MID = 0.9;
/** Radius breathing: slow sine plus low-band push. */
const BREATH_SINE = 0.035;
const BREATH_LOW = 0.1;
/** Cursor scale sparkle from the high band. */
const SPARKLE_HIGH = 0.16;
/** Synthetic beat used when no live audio levels are available (deterministic). */
const PULSE_BPM = 112;
/** Share of the synthetic beat kept when real levels are available. */
const SYNTH_FLOOR = 0.7;
const HALO_ACCEL = 2400;
const HALO_SLOW_RADIUS = 50;
const HALO_SPEED_BOOST = 1.5;

/** Smoothed audio levels driving the halo. */
export interface HaloLevels {
  low: number;
  mid: number;
  high: number;
}

interface HaloProps extends Record<string, unknown> {
  x: number;
  y: number;
  r: number;
  level: number;
  bands: number[];
  colors: string[];
  /** Overlay opacity 0..1; below 1 only while the halo fades out. */
  alpha: number;
}

/**
 * Finale "halo": the crew forms two or three concentric rings around the viewport centre.
 * Rings rotate in alternating directions with the mid band, breathe with the low band and
 * sparkle (cursor scale) with the high band. Without live audio a built-in 112 bpm pulse
 * drives the same parameters, so the result is deterministic under a virtual clock.
 */
export class HaloFormation {
  #slots = new Float64Array(0);
  #ringOf = new Int32Array(0);
  #ringRadius: readonly number[] = TWO_RING_RADII;
  #phase: number[] = [0, 0, 0];
  #overlay: OverlayHandle | null = null;
  #props: HaloProps | null = null;
  readonly levels: HaloLevels = { low: 0, mid: 0, high: 0 };
  #lastPt = 0;
  /** Player time the fade-out started, or -1 while the halo is fully shown. */
  #fadeFrom = -1;
  #fadeMs = 0;

  /** Assigns ring slots to `count` agents and creates the halo overlay. */
  begin(stage: StageApi, count: number, colors: readonly string[], pt: number): void {
    this.end();
    const rings = count <= TWO_RING_MAX ? TWO_RING_RADII : THREE_RING_RADII;
    this.#ringRadius = rings;
    this.#phase = rings.map(() => 0);
    this.#slots = new Float64Array(count);
    this.#ringOf = new Int32Array(count);
    const total = rings.reduce((sum, r) => sum + r, 0);
    let assigned = 0;
    for (let k = 0; k < rings.length; k++) {
      const share = (rings[k] as number) / total;
      const n = k === rings.length - 1 ? count - assigned : Math.max(1, Math.round(count * share));
      const take = Math.min(n, count - assigned);
      for (let j = 0; j < take; j++) {
        this.#ringOf[assigned + j] = k;
        // Stagger alternate rings by half a slot so cursors do not line up radially.
        this.#slots[assigned + j] = ((j + (k % 2) * 0.5) / Math.max(1, take)) * Math.PI * 2;
      }
      assigned += take;
    }
    this.#lastPt = pt;
    this.levels.low = 0;
    this.levels.mid = 0;
    this.levels.high = 0;
    this.#props = {
      x: 0,
      y: 0,
      r: 0,
      level: 0,
      bands: new Array<number>(HALO_BANDS).fill(0),
      colors: [...colors],
      alpha: 1,
    };
    this.#overlay = stage.overlay("halo", this.#props);
  }

  get active(): boolean {
    return this.#props !== null;
  }

  /** True while the overlay fades out after {@link fadeOut}. */
  get fading(): boolean {
    return this.#props !== null && this.#fadeFrom >= 0;
  }

  /**
   * Fades the overlay out over `ms` from player time `pt`, then removes it; the rings keep turning
   * meanwhile. Opacity follows player time only, so the same run fades the same way every time.
   * Without a fade time the overlay goes at once.
   */
  fadeOut(pt: number, ms: number): void {
    if (!this.#props) return;
    if (!(ms > 0)) {
      this.end();
      return;
    }
    this.#fadeFrom = pt;
    this.#fadeMs = ms;
  }

  /**
   * Updates levels and ring phases for this frame and refreshes the overlay.
   * @param real Live levels from the sound engine, or null when unavailable / not deterministic.
   */
  frame(vp: Rect, pt: number, real: { low: number; mid: number; high: number } | null): void {
    const dt = Math.max(0, pt - this.#lastPt) / 1000;
    this.#lastPt = pt;
    const beat = ((pt / 1000) * PULSE_BPM) / 60;
    const frac = beat - Math.floor(beat);
    const pulse = Math.exp(-frac * 6);
    const synthLow = 0.25 + 0.55 * pulse;
    const synthMid = 0.35 + 0.15 * Math.sin(beat * Math.PI * 0.5);
    const synthHigh = 0.2 + 0.4 * Math.exp(-((frac * 2) % 1) * 9);
    const lv = this.levels;
    if (real) {
      lv.low = Math.max(clamp(real.low, 0, 1), synthLow * SYNTH_FLOOR);
      lv.mid = Math.max(clamp(real.mid, 0, 1), synthMid * SYNTH_FLOOR);
      lv.high = Math.max(clamp(real.high, 0, 1), synthHigh * SYNTH_FLOOR);
    } else {
      lv.low = synthLow;
      lv.mid = synthMid;
      lv.high = synthHigh;
    }
    const omega = SPIN_BASE + SPIN_MID * lv.mid;
    for (let k = 0; k < this.#phase.length; k++) {
      this.#phase[k] = (this.#phase[k] as number) + omega * dt * (k % 2 === 0 ? 1 : -1) * (1 - 0.15 * k);
    }
    const props = this.#props;
    if (!props || !this.#overlay) return;
    if (this.#fadeFrom >= 0) {
      props.alpha = clamp(1 - (pt - this.#fadeFrom) / this.#fadeMs, 0, 1);
      if (props.alpha <= 0) {
        this.end();
        return;
      }
    }
    props.x = vp.x + vp.w / 2;
    props.y = vp.y + vp.h / 2;
    props.r = this.#outer(vp, pt);
    props.level = clamp((lv.low + lv.mid + lv.high) / 3, 0, 1);
    const bands = props.bands;
    for (let b = 0; b < HALO_BANDS; b++) {
      const f = b / (HALO_BANDS - 1);
      const base = f < 0.33 ? lv.low : f < 0.66 ? lv.mid : lv.high;
      bands[b] = clamp(base * (0.75 + 0.25 * Math.sin(beat * Math.PI + b * 0.9)), 0, 1);
    }
    this.#overlay.update(props);
  }

  /** Steers the agent with halo slot `slot` toward its place on its ring. */
  steer(agent: Agent, slot: number, vp: Rect, pt: number, h: number): void {
    if (slot < 0 || slot >= this.#slots.length) return;
    const ring = this.#ringOf[slot] as number;
    const theta = (this.#slots[slot] as number) + (this.#phase[ring] as number);
    const r = this.#outer(vp, pt) * (this.#ringRadius[ring] as number);
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    steerTo(
      agent,
      cx + r * Math.cos(theta),
      cy + r * Math.sin(theta),
      agent.maxSpeed * HALO_SPEED_BOOST,
      HALO_ACCEL,
      HALO_SLOW_RADIUS,
      h,
    );
  }

  /** Cursor scale for the current high-band sparkle; staggered per slot. */
  scaleFor(slot: number): number {
    const s = this.levels.high * (0.5 + 0.5 * Math.sin(slot * 2.39996));
    return 1 + SPARKLE_HIGH * s;
  }

  #outer(vp: Rect, pt: number): number {
    const breath = 1 + BREATH_SINE * Math.sin((pt / 1000) * 1.7) + BREATH_LOW * this.levels.low;
    return Math.min(vp.w, vp.h) * OUTER_SHARE * breath;
  }

  /** Removes the overlay. */
  end(): void {
    this.#overlay?.remove();
    this.#overlay = null;
    this.#props = null;
    this.#fadeFrom = -1;
  }
}
