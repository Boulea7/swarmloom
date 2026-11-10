import type { GuideLine } from "../overlay";
import { clamp01 } from "./layers/common";
import type { GuideSlot, LayerRegistry } from "./registry";

/** A revealed guide stays at most this long when its members never finish (behaviour spec 7.5 lease). */
const LEASE_MS = 4500;
/** Reduced motion: guides only flash briefly. */
const REDUCED_LEASE_MS = 300;
/** Fade-out after the lease ends. */
const FADE_MS = 400;

interface GuideState {
  readonly slot: GuideSlot;
  readonly members: readonly { finished: boolean }[];
  readonly line: GuideLine;
  shownAt: number;
  endAt: number;
}

/**
 * Blueprint guide layers, drawn as lines on the overlay canvas (never DOM): a guide appears when
 * revealed, holds while the layers that snap to it are being built (its lease), then fades out.
 * Lines are preallocated; update() allocates nothing.
 */
export class GuideLines {
  readonly #states: GuideState[] = [];
  readonly #lease: number;

  constructor(registry: LayerRegistry, out: GuideLine[], reducedMotion: boolean) {
    this.#lease = reducedMotion ? REDUCED_LEASE_MS : LEASE_MS;
    for (const slot of registry.guides) {
      const line: GuideLine = { axis: slot.layer.axis, pos: slot.layer.pos, len: 0, alpha: 0 };
      out.push(line);
      this.#states.push({
        slot,
        members: registry.dependents.get(slot) ?? [],
        line,
        shownAt: Number.NaN,
        endAt: Number.NaN,
      });
    }
  }

  /** Fills `out` (the array passed to the constructor) for engine time `now`; returns the line count. */
  update(now: number, out: GuideLine[]): number {
    let n = 0;
    for (let i = 0; i < this.#states.length; i++) {
      const g = this.#states[i] as GuideState;
      const p = clamp01(g.slot.p);
      if (p <= 0) {
        g.shownAt = Number.NaN;
        g.endAt = Number.NaN;
        continue;
      }
      // Engine time can jump backwards (seek): restart the lease rather than fading forever.
      if (!(g.shownAt <= now)) {
        g.shownAt = now;
        g.endAt = Number.NaN;
      }
      if (!Number.isFinite(g.endAt) && (now - g.shownAt >= this.#lease || membersDone(g))) g.endAt = now;
      const alpha = Number.isFinite(g.endAt) ? 1 - (now - g.endAt) / FADE_MS : 1;
      if (alpha <= 0) continue;
      g.line.len = p;
      g.line.alpha = Math.min(alpha, 1);
      out[n++] = g.line;
    }
    return n;
  }

  reset(): void {
    for (const g of this.#states) {
      g.shownAt = Number.NaN;
      g.endAt = Number.NaN;
    }
  }
}

function membersDone(g: GuideState): boolean {
  const m = g.members;
  if (m.length === 0) return g.slot.finished;
  for (let i = 0; i < m.length; i++) if (!(m[i] as { finished: boolean }).finished) return false;
  return true;
}
