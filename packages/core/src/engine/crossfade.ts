import type { Layer, StageApi } from "../types";
import type { Schedule } from "./schedule";

export interface CrossFadeTiming {
  /** Fade length of one layer, task ms. */
  fadeMs: number;
  /** Budget of the whole pass (last fade ends by then), task ms. */
  totalMs: number;
  /** Upper bound of the gap between two fade starts, task ms. */
  maxStaggerMs: number;
}

/**
 * Cursor-free build: layers fade in one after another in the plan's topological reading order
 * (parents before children). Used for reduced motion and for "finish now".
 *
 * Fade `k` runs over [k * stagger, k * stagger + fade], so completion order equals start order
 * and the active fades are always a contiguous range of the queue (no per-frame allocation).
 */
export class CrossFade {
  readonly #queue: Int32Array;
  readonly #layers: readonly Layer[];
  readonly #fade: number;
  readonly #stagger: number;
  readonly #start: number;
  #started = 0;
  #done = 0;

  /**
   * @param queue Tasks to fade, in order (tasks already done are skipped by the caller).
   * @param startAt Task time at which the first fade starts.
   */
  constructor(queue: Int32Array, layers: readonly Layer[], startAt: number, timing: CrossFadeTiming) {
    this.#queue = queue;
    this.#layers = layers;
    this.#fade = Math.max(1, timing.fadeMs);
    const spread = Math.max(0, timing.totalMs - this.#fade);
    this.#stagger = queue.length > 1 ? Math.min(timing.maxStaggerMs, spread / (queue.length - 1)) : 0;
    this.#start = startAt;
  }

  get finished(): boolean {
    return this.#done >= this.#queue.length;
  }

  /** Task time at which the last fade ends. */
  get endsAt(): number {
    return this.#start + Math.max(0, this.#queue.length - 1) * this.#stagger + this.#fade;
  }

  /**
   * Advances the pass to task time `tt`: reveals fading layers, finishes completed ones and
   * marks them done in the schedule.
   * @param onError Called with stage errors; the pass continues.
   */
  step(tt: number, stage: StageApi, schedule: Schedule, onError: (error: unknown, layer: Layer) => void): void {
    const queue = this.#queue;
    const elapsed = tt - this.#start;
    while (this.#started < queue.length && this.#started * this.#stagger <= elapsed) this.#started++;
    for (let k = this.#done; k < this.#started; k++) {
      const task = queue[k] as number;
      const layer = this.#layers[task] as Layer;
      const p = (elapsed - k * this.#stagger) / this.#fade;
      try {
        if (p >= 1) {
          stage.reveal(layer.id, 1);
          stage.finish(layer.id);
        } else {
          stage.reveal(layer.id, Math.max(p, 0));
        }
      } catch (error) {
        onError(error, layer);
      }
      if (p >= 1) {
        schedule.complete(task);
        this.#done = k + 1;
      }
    }
  }
}
