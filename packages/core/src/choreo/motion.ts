/**
 * Time and motion building blocks shared by the tasks: easing, tweens, drags that update
 * overlays every frame, timed event bursts, clicks.
 */

import type { AgentApi, TaskGen } from "../types";
import type { TaskScope } from "./scope";
import { CLICK_HOLD_MS, clamp, pick, type Range, TWEEN_STEP_MS } from "./timing";

export type EaseFn = (t: number) => number;

export const linear: EaseFn = (t) => t;
export const easeOut: EaseFn = (t) => 1 - (1 - t) ** 3;
export const easeInOut: EaseFn = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Waits shorter than this are treated as already due (float noise in accumulated times). */
const EPSILON_MS = 0.001;
/** A broken clock that never advances must not hang a tween: give up after this many extra frames. */
const STALL_FRAMES = 120;

/**
 * An agent that may expose the engine task clock. `now()` is not a member of the public AgentApi
 * contract; an engine that adds it (task time in engine ms, speed applied, the timeline yielded
 * waits are measured in) lets tweens and typing bursts stay exact when frames are coarser than the
 * waits they asked for. Without it the choreographies count fixed steps.
 */
export type ClockedAgent = AgentApi & { now?: () => number };

/** The agent's task clock, when the engine provides one. */
function clockOf(agent: AgentApi): (() => number) | null {
  const now = (agent as ClockedAgent).now;
  return typeof now === "function" ? () => now.call(agent) : null;
}

/**
 * Runs `inner` (usually `agent.moveTo`/`dragTo`) and calls `onStep` after every step, when the
 * agent has moved for that frame. Overlays and transient styles updated in `onStep` therefore
 * follow the cursor exactly. Aborting the outer generator also closes `inner`.
 */
export function* track(inner: TaskGen, onStep: () => void): TaskGen {
  let done = false;
  try {
    let input: unknown;
    for (;;) {
      const step = inner.next(input);
      onStep();
      if (step.done) {
        done = true;
        return;
      }
      input = yield step.value;
    }
  } finally {
    if (!done) inner.return(undefined);
  }
}

/**
 * Calls `onProgress(eased t)` from 0 to exactly 1 over `durationMs` of engine time.
 * Uses the agent clock when available (exact at any speed); otherwise waits in fixed steps.
 */
export function* tween(
  agent: AgentApi,
  durationMs: number,
  onProgress: (t: number) => void,
  ease: EaseFn = easeInOut,
): TaskGen {
  if (!(durationMs > 0)) {
    onProgress(1);
    return;
  }
  const clock = clockOf(agent);
  if (clock) {
    const start = clock();
    const maxFrames = Math.ceil(durationMs) + STALL_FRAMES;
    for (let frame = 0; frame < maxFrames; frame++) {
      const t = (clock() - start) / durationMs;
      if (!(t < 1)) break;
      onProgress(ease(clamp(t, 0, 1)));
      yield undefined;
    }
  } else {
    const steps = Math.max(1, Math.ceil(durationMs / TWEEN_STEP_MS));
    const step = durationMs / steps;
    for (let i = 0; i < steps; i++) {
      onProgress(ease(i / steps));
      yield step;
    }
  }
  onProgress(1);
}

/**
 * Fires events at the given offsets (engine ms from the start, ascending). When a frame is
 * coarser than the gaps (high speed, slow device) every overdue event fires in the same batch;
 * `onEvent` receives its index within the batch so callers can cap per-frame sounds, and
 * `onBatch` runs once per batch with the last fired index and the elapsed time.
 */
export function* runTimeline(
  agent: AgentApi,
  times: readonly number[],
  onEvent: (index: number, batchIndex: number) => void,
  onBatch: (lastIndex: number, elapsedMs: number) => void,
): TaskGen {
  const clock = clockOf(agent);
  const start = clock ? clock() : 0;
  let elapsed = 0;
  let index = 0;
  while (index < times.length) {
    const due = times[index] ?? elapsed;
    const wait = due - elapsed;
    if (wait > EPSILON_MS) {
      yield wait;
      // The engine resumes no earlier than asked; the clock (if any) tells how much later.
      elapsed = Math.max(elapsed + wait, clock ? clock() - start : 0);
    }
    let batch = 0;
    while (index < times.length && (times[index] ?? 0) <= elapsed + EPSILON_MS) {
      onEvent(index, batch);
      batch++;
      index++;
    }
    onBatch(index - 1, elapsed);
  }
}

/** Cumulative offsets from per-event delays. */
export function offsets(delays: readonly number[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const d of delays) {
    t += d;
    out.push(t);
  }
  return out;
}

/** A single click at the current position: press, short hold, release (with sounds). */
export function* click(scope: TaskScope): TaskGen {
  scope.press();
  yield pick(scope.agent.rng, CLICK_HOLD_MS);
  scope.release();
}

/** Two clicks `gap` ms apart (measured between the two presses' releases and presses). */
export function* doubleClick(scope: TaskScope, gap: Range): TaskGen {
  yield* click(scope);
  yield pick(scope.agent.rng, gap);
  yield* click(scope);
}
