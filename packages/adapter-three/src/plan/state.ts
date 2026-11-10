/**
 * CPU side of the per-patch reveal state. The array is uploaded as a float RGBA texture
 * (width = patches, height = STATE_ROWS); texel (patch, row) component c holds channel c
 * (x = points, y = edges, z = faces). Shaders derive each element's birth time from it, so
 * pop-in animations depend only on engine time and reveal calls (deterministic export).
 */

/** Build channels that animate per element. */
export const CHANNEL = { points: 0, edges: 1, faces: 2 } as const;
export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];

/** Row layout of the state texture. */
export const ROW = { progress: 0, time: 1, rate: 2, cutoff: 3, tintR: 4, tintG: 5, tintB: 6 } as const;
export const STATE_ROWS = 7;

/** How a reveal step is animated. */
export interface RevealHint {
  /** Engine ms over which the newly revealed elements are born. Default: time since the last step (16..400). */
  spreadMs?: number;
  /** Elements revealed by earlier steps stop animating (taps); otherwise births extrapolate (drags). */
  chunk?: boolean;
}

const NEVER = -1;

export class RevealState {
  readonly patches: number;
  /** RGBA float texels, row-major: index = ((row * patches) + patch) * 4 + channel. */
  readonly texels: Float32Array;
  /** Material group mix 0..1 (clay -> real material). */
  readonly materials: Float32Array;
  /** Light sweep progress 0..1. */
  light = 0;
  /** Engine time of the latest frame, ms. */
  now = 0;
  /** Engine time until which element animations are still running. */
  animatingUntil = 0;
  /** Set whenever texels or scalars change; cleared by the uploader. */
  dirty = true;
  readonly #lastSet: Float64Array;

  constructor(patches: number, materialGroups: number) {
    this.patches = Math.max(1, patches);
    this.texels = new Float32Array(this.patches * STATE_ROWS * 4);
    this.materials = new Float32Array(Math.max(1, materialGroups));
    this.#lastSet = new Float64Array(this.patches * 3).fill(NEVER);
    for (let p = 0; p < this.patches; p++) for (let c = 0; c < 3; c++) this.#write(ROW.cutoff, p, c, -1);
  }

  #index(row: number, patch: number, channel: number): number {
    return (row * this.patches + patch) * 4 + channel;
  }

  #write(row: number, patch: number, channel: number, value: number): void {
    this.texels[this.#index(row, patch, channel)] = value;
  }

  #valid(channel: number, patch: number): boolean {
    return Number.isInteger(patch) && patch >= 0 && patch < this.patches && channel >= 0 && channel < 3;
  }

  /** Current progress 0..1 of a channel of a patch. */
  progress(channel: Channel, patch: number): number {
    return this.#valid(channel, patch) ? (this.texels[this.#index(ROW.progress, patch, channel)] as number) : 0;
  }

  /**
   * Moves a channel of a patch to progress `p` (clamped to 0..1). Increases animate the newly
   * revealed elements; decreases (replay) hide them immediately.
   */
  reveal(channel: Channel, patch: number, p: number, hint: RevealHint = {}, popMs = 300): void {
    if (!this.#valid(channel, patch) || !Number.isFinite(p)) return;
    const next = Math.min(1, Math.max(0, p));
    const prev = this.progress(channel, patch);
    const slot = patch * 3 + channel;
    if (next <= prev) {
      if (next < prev) this.#settle(channel, patch, next);
      return;
    }
    const last = this.#lastSet[slot] as number;
    const since = last === NEVER ? 16 : this.now - last;
    const spread = Math.max(1, hint.spreadMs ?? Math.min(400, Math.max(16, since)));
    this.#write(ROW.progress, patch, channel, next);
    this.#write(ROW.time, patch, channel, this.now);
    this.#write(ROW.rate, patch, channel, (next - prev) / spread);
    this.#write(ROW.cutoff, patch, channel, hint.chunk ? prev : -1);
    this.#lastSet[slot] = this.now;
    this.animatingUntil = Math.max(this.animatingUntil, this.now + popMs);
    this.dirty = true;
  }

  /** Final state without animation (finish, finishAll, reduced motion). */
  finish(channel: Channel, patch: number): void {
    if (this.#valid(channel, patch)) this.#settle(channel, patch, 1);
  }

  /** Back to nothing revealed (replay, remount). */
  reset(channel: Channel, patch: number): void {
    if (this.#valid(channel, patch)) this.#settle(channel, patch, 0);
  }

  #settle(channel: number, patch: number, p: number): void {
    this.#write(ROW.progress, patch, channel, p);
    this.#write(ROW.rate, patch, channel, 0);
    this.#write(ROW.cutoff, patch, channel, -1);
    this.#lastSet[patch * 3 + channel] = NEVER;
    this.dirty = true;
  }

  /** Colour (linear RGB 0..1) newly revealed elements of a channel flash in. */
  tint(channel: Channel, patch: number, r: number, g: number, b: number): void {
    if (!this.#valid(channel, patch)) return;
    this.#write(ROW.tintR, patch, channel, r);
    this.#write(ROW.tintG, patch, channel, g);
    this.#write(ROW.tintB, patch, channel, b);
    this.dirty = true;
  }

  setMaterial(group: number, p: number): void {
    if (!(group >= 0 && group < this.materials.length) || !Number.isFinite(p)) return;
    this.materials[group] = Math.min(1, Math.max(0, p));
    this.dirty = true;
  }

  setLight(p: number): void {
    if (!Number.isFinite(p)) return;
    this.light = Math.min(1, Math.max(0, p));
    this.dirty = true;
  }

  /** Mean material mix over all groups (drives the build wireframe fade-out). */
  materialMean(): number {
    let sum = 0;
    for (const m of this.materials) sum += m;
    return sum / this.materials.length;
  }
}
