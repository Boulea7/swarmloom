import type {
  Blueprint,
  CSSMap,
  Layer,
  OverlayHandle,
  OverlayKind,
  Point,
  Rect,
  StageApi,
  TaskGen,
  Yield,
} from "../types";
import type { Agent } from "./agent";
import { MAX_STEPS_PER_FRAME } from "./constants";

/**
 * StageApi handed to one task. Delegates everything to the stage, and remembers overlays the
 * task created and whether it finished its own layer, so the engine can clean up after
 * failures, aborts and careless choreographies.
 */
export class ScopedStage implements StageApi {
  readonly #stage: StageApi;
  readonly #own: string;
  #handles: Set<OverlayHandle> | null = null;
  /** True once the task called finish() on its own layer. */
  finishedOwn = false;

  constructor(stage: StageApi, ownLayerId: string) {
    this.#stage = stage;
    this.#own = ownLayerId;
  }

  get blueprint(): Blueprint {
    return this.#stage.blueprint;
  }

  layer(id: string): Layer | undefined {
    return this.#stage.layer(id);
  }

  el(id: string): HTMLElement | SVGElement | null {
    return this.#stage.el(id);
  }

  reveal(id: string, p: number): void {
    this.#stage.reveal(id, p);
  }

  finish(id: string): void {
    if (id === this.#own) this.finishedOwn = true;
    this.#stage.finish(id);
  }

  setStyle(id: string, css: CSSMap | null): void {
    this.#stage.setStyle(id, css);
  }

  overlay(kind: OverlayKind, props: Record<string, unknown>): OverlayHandle {
    const inner = this.#stage.overlay(kind, props);
    this.#handles ??= new Set();
    const handles = this.#handles;
    const handle: OverlayHandle = {
      update: (next) => {
        if (handles.has(handle)) inner.update(next);
      },
      remove: () => {
        if (handles.delete(handle)) inner.remove();
      },
    };
    handles.add(handle);
    return handle;
  }

  viewport(): Rect {
    return this.#stage.viewport();
  }

  caretAt(id: string, n: number): Point {
    return this.#stage.caretAt(id, n);
  }

  /**
   * Removes overlays the task left behind.
   * @returns How many were left.
   */
  dispose(): number {
    const handles = this.#handles;
    if (!handles || handles.size === 0) return 0;
    const left = handles.size;
    for (const handle of [...handles]) handle.remove();
    return left;
  }
}

/** A promise a task yielded, settled into plain fields so the frame loop never awaits. */
export interface PromiseWait {
  settled: boolean;
  ok: boolean;
  value: unknown;
}

/** One running choreography. */
export interface TaskRun {
  /** Plan node index. */
  readonly task: number;
  readonly key: string;
  readonly layer: Layer;
  readonly gen: TaskGen;
  readonly scope: ScopedStage;
  /** Task time when the task started. */
  readonly startedAt: number;
  /** Task time after which the task is aborted as stuck. */
  readonly deadline: number;
  /** Task time at which the generator resumes. */
  wakeAt: number;
  /** True when the last yield asked for "next frame" rather than a duration. */
  frameWait: boolean;
  wait: PromiseWait | null;
  /** An unsupported yield value was already reported. */
  badYield: boolean;
}

export interface RunHost {
  /** Registers a promise a task waits on; Player.ready() awaits it. Never rejects. */
  track(promise: Promise<void>): void;
  report(error: unknown, run: TaskRun): void;
}

export const RUN_ACTIVE = 0;
export const RUN_DONE = 1;
export const RUN_FAILED = 2;
export type RunResult = typeof RUN_ACTIVE | typeof RUN_DONE | typeof RUN_FAILED;

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";
}

/**
 * Advances a task generator up to task time `tt`, implementing the yield protocol:
 *  - number: wait that many task ms. Short waits are caught up inside the same frame, and the
 *    agent clock (`agent.now()`) reads the exact scheduled time, so typing bursts and tweens
 *    keep their timing even when frames are coarser than the waits.
 *  - undefined: resume on the next frame.
 *  - promise: resume after it settles (rejections are thrown into the generator).
 * Stuck tasks (past their deadline), thrown errors and invalid waits end the run as failed.
 */
export function stepRun(agent: Agent, run: TaskRun, tt: number, host: RunHost): RunResult {
  let input: unknown;
  let throwInput = false;
  if (run.wait) {
    const wait = run.wait;
    if (!wait.settled) return tt > run.deadline ? timedOut(run, host) : RUN_ACTIVE;
    run.wait = null;
    agent.localTime = tt;
    input = wait.value;
    throwInput = !wait.ok;
  } else {
    if (tt > run.deadline) return timedOut(run, host);
    if (tt < run.wakeAt) return RUN_ACTIVE;
    agent.localTime = run.frameWait ? tt : run.wakeAt;
  }
  for (let steps = 0; steps < MAX_STEPS_PER_FRAME; steps++) {
    let result: IteratorResult<Yield, void>;
    try {
      result = throwInput ? run.gen.throw(input) : run.gen.next(input);
    } catch (error) {
      host.report(error, run);
      return RUN_FAILED;
    }
    throwInput = false;
    input = undefined;
    if (result.done) return RUN_DONE;
    const value: unknown = result.value;
    if (value === undefined) {
      run.frameWait = true;
      run.wakeAt = tt;
      return RUN_ACTIVE;
    }
    if (typeof value === "number") {
      if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
        host.report(new RangeError(`task yielded an invalid wait (${value})`), run);
        return RUN_FAILED;
      }
      const wake = agent.localTime + (value > 0 ? value : 0);
      if (wake <= tt) {
        agent.localTime = wake;
        continue;
      }
      run.wakeAt = wake;
      run.frameWait = false;
      return RUN_ACTIVE;
    }
    if (isThenable(value)) {
      const wait: PromiseWait = { settled: false, ok: true, value: undefined };
      run.wait = wait;
      host.track(
        Promise.resolve(value).then(
          (v) => {
            wait.settled = true;
            wait.value = v;
          },
          (error: unknown) => {
            wait.settled = true;
            wait.ok = false;
            wait.value = error;
          },
        ),
      );
      return RUN_ACTIVE;
    }
    if (!run.badYield) {
      run.badYield = true;
      host.report(new TypeError(`task yielded an unsupported value of type ${typeof value}`), run);
    }
    run.frameWait = true;
    run.wakeAt = tt;
    return RUN_ACTIVE;
  }
  // Step budget used up while catching up: continue from the same task time next frame.
  run.frameWait = false;
  run.wakeAt = agent.localTime;
  return RUN_ACTIVE;
}

function timedOut(run: TaskRun, host: RunHost): RunResult {
  host.report(new Error(`task timed out after ${Math.round(run.deadline - run.startedAt)} ms`), run);
  return RUN_FAILED;
}

/** Closes a generator early (its finally blocks run) and removes overlays it left. */
export function closeRun(run: TaskRun, onError: (error: unknown) => void): number {
  try {
    run.gen.return(undefined);
  } catch (error) {
    onError(error);
  }
  return run.scope.dispose();
}
