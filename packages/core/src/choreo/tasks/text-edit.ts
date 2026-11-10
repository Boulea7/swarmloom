/** Text editing state shared by text and duplicate tasks: the edit frame and caret typing. */

import type { OverlayHandle, Rect, TaskGen } from "../../types";
import { isFinitePoint } from "../geometry";
import { offsets, runTimeline } from "../motion";
import type { TaskScope } from "../scope";
import type { FontMetrics } from "../text-units";
import {
  CARET_HEIGHT_RATIO,
  CARET_REFRESH_MS,
  clamp,
  MAX_SOUNDS_PER_BATCH,
  pick,
  TYPE_END_MS,
  TYPE_START_MS,
} from "../timing";
import { planTyping, type TypingOptions } from "../typing";

/** Text box outline shown while a text is edited; grows line by line with the typed text. */
export class EditFrame {
  #rect: Rect;
  #handles = false;

  constructor(
    private readonly handle: OverlayHandle,
    initial: Rect,
    /** The frame never grows below this rect's bottom. */
    private readonly full: Rect,
  ) {
    this.#rect = initial;
  }

  get rect(): Rect {
    return this.#rect;
  }

  get overlay(): OverlayHandle {
    return this.handle;
  }

  set(r: Rect): void {
    this.#rect = r;
    this.handle.update({ ...r, handles: this.#handles });
  }

  /** Shows or hides the resize handles (shown while a heading is dragged larger). */
  setHandles(on: boolean): void {
    this.#handles = on;
    this.set(this.#rect);
  }

  /** Extends the frame down to `bottom` (never shrinks, never beyond the full text box). */
  growTo(bottom: number): void {
    const max = Math.max(this.#rect.h, this.full.y + this.full.h - this.#rect.y);
    const h = clamp(bottom - this.#rect.y, this.#rect.h, max);
    if (h - this.#rect.h >= 1) this.set({ ...this.#rect, h });
  }
}

/** Where typing starts and how fast it goes. */
export interface TypeIntoOptions extends TypingOptions {
  /** Units already visible before typing starts. Default 0. */
  from?: number;
}

/**
 * Types `units` into layer `id` with a blinking caret, revealing `end / total` after every batch
 * of strokes. Key sounds follow the strokes (at most {@link MAX_SOUNDS_PER_BATCH} per frame). The
 * caret and frame are re-measured at most every {@link CARET_REFRESH_MS}, because each `caretAt`
 * may force a layout.
 */
export function* typeInto(
  scope: TaskScope,
  id: string,
  units: readonly string[],
  metrics: FontMetrics,
  frame: EditFrame | null,
  opts: TypeIntoOptions = {},
): TaskGen {
  const { agent, stage } = scope;
  const total = units.length;
  const from = clamp(Math.floor(opts.from ?? 0), 0, total);
  if (from >= total) {
    stage.reveal(id, 1);
    return;
  }
  const strokes = planTyping(from > 0 ? units.slice(from) : units, agent.rng, opts);
  const caretH = Math.min(metrics.lineHeight, metrics.fontSize * CARET_HEIGHT_RATIO);
  let caret: OverlayHandle | null = null;
  const placeCaret = (n: number): void => {
    const p = stage.caretAt(id, n);
    if (!isFinitePoint(p)) return;
    if (caret) caret.update({ x: p.x, y: p.y, h: caretH });
    else caret = scope.overlay("caret", { x: p.x, y: p.y, h: caretH });
    frame?.growTo(p.y + caretH);
  };

  stage.reveal(id, from / total);
  placeCaret(from);
  yield pick(agent.rng, TYPE_START_MS);
  let lastMeasure = Number.NEGATIVE_INFINITY;
  yield* runTimeline(
    agent,
    offsets(strokes.map((s) => s.delay)),
    (i, batch) => {
      const stroke = strokes[i];
      if (stroke && batch < MAX_SOUNDS_PER_BATCH) agent.sound(stroke.sound, { vel: stroke.vel });
    },
    (last, elapsed) => {
      const end = from + (strokes[last]?.end ?? total - from);
      stage.reveal(id, end / total);
      if (end === total || elapsed - lastMeasure >= CARET_REFRESH_MS) {
        placeCaret(end);
        lastMeasure = elapsed;
      }
    },
  );
  stage.reveal(id, 1);
  yield pick(agent.rng, TYPE_END_MS);
  scope.drop(caret);
}
