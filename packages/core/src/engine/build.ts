import type { Layer, Plugin, StageApi, TaskFn, TaskGen } from "../types";
import { type Agent, WORKING } from "./agent";
import { TASK_TIMEOUT_FACTOR, TASK_TIMEOUT_MIN_MS } from "./constants";
import { fallbackFade } from "./fallback";
import { FLAG_GUIDE, FLAG_SNAPS, type Plan } from "./planner";
import { closeRun, RUN_ACTIVE, RUN_FAILED, type RunHost, ScopedStage, stepRun, type TaskRun } from "./runner";
import { Schedule } from "./schedule";
import { streamRng } from "./streams";

/** Services the build needs from the engine. */
export interface BuildHost {
  readonly stage: StageApi;
  readonly seed: number;
  /** A task failed (threw, timed out, bad yield); `layer` is finished in its final state anyway. */
  fail(error: unknown, layer: Layer): void;
  /** Registers a promise a task waits on (Player.ready() awaits it). Never rejects. */
  track(promise: Promise<void>): void;
  /** Optional: a task is about to start on layer `id` (see Stage.prefetch). */
  prefetch?(id: string): void;
}

/**
 * Choreography table from plugins in order: a later plugin overrides the task keys of earlier
 * ones. Non-function entries are ignored.
 */
export function mergeTasks(plugins: readonly Plugin[]): Map<string, TaskFn> {
  const tasks = new Map<string, TaskFn>();
  for (const plugin of plugins) {
    const table = plugin.tasks;
    if (!table || typeof table !== "object") continue;
    for (const [key, fn] of Object.entries(table)) {
      if (typeof fn === "function") tasks.set(key, fn as TaskFn);
    }
  }
  return tasks;
}

function isGenerator(v: unknown): v is TaskGen {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as TaskGen).next === "function" &&
    typeof (v as TaskGen).return === "function" &&
    typeof (v as TaskGen).throw === "function"
  );
}

/**
 * Runs layer tasks on agents: resolves the choreography of each layer, drives its generator
 * through {@link stepRun}, and guarantees that every task ends with its layer finished and its
 * overlays removed, whether it completed, failed or was aborted.
 */
export class Build {
  readonly plan: Plan;
  readonly schedule: Schedule;
  readonly #tasks: ReadonlyMap<string, TaskFn>;
  readonly #host: BuildHost;
  readonly #runHost: RunHost;
  /** Running tasks that build or snap to a guide (the stage shows rulers while > 0). */
  #guideRuns = 0;
  /** Identity of this build handed to every task's stage; a replay starts a new build. */
  readonly #key: object = Object.freeze({});

  constructor(plan: Plan, tasks: ReadonlyMap<string, TaskFn>, host: BuildHost) {
    this.plan = plan;
    this.schedule = new Schedule(plan);
    this.#tasks = tasks;
    this.#host = host;
    this.#runHost = {
      track: (promise) => host.track(promise),
      report: (error, run) => host.fail(error, run.layer),
    };
  }

  /** True while a running task builds or snaps to a guide. */
  get guidesActive(): boolean {
    return this.#guideRuns > 0;
  }

  /**
   * Choreography for task `i`: "duplicate" for copies (falling back to the layer kind), the
   * kind or custom task name otherwise; without one, a plugin's "fade" task, else the engine's
   * own fade.
   */
  resolve(i: number): TaskFn {
    const key = this.plan.keys[i] as string;
    const layer = this.plan.layers[i] as Layer;
    return (
      this.#tasks.get(key) ??
      (key === "duplicate" ? this.#tasks.get(layer.kind) : undefined) ??
      this.#tasks.get("fade") ??
      fallbackFade
    );
  }

  /** Starts available task `i` on an agent at task time `t`. */
  start(agent: Agent, i: number, t: number): void {
    const { plan } = this;
    this.schedule.start(i);
    const layer = plan.layers[i] as Layer;
    this.#host.prefetch?.(layer.id);
    const scope = new ScopedStage(this.#host.stage, layer.id, this.#key);
    agent.mode = WORKING;
    agent.role = plan.roles[i] ?? null;
    agent.taskRng = streamRng(this.#host.seed, `task:${layer.id}`);
    agent.localTime = t;
    let gen: TaskGen;
    try {
      const made: unknown = this.resolve(i)(agent, layer, scope);
      if (!isGenerator(made)) throw new TypeError(`choreography "${plan.keys[i]}" did not return a generator`);
      gen = made;
    } catch (error) {
      this.#host.fail(error, layer);
      this.#settle(agent, i, scope);
      return;
    }
    const estimate = plan.estimate[i] as number;
    const run: TaskRun = {
      task: i,
      key: plan.keys[i] as string,
      layer,
      gen,
      scope,
      startedAt: t,
      deadline: t + Math.max(estimate * TASK_TIMEOUT_FACTOR, TASK_TIMEOUT_MIN_MS),
      wakeAt: t,
      frameWait: false,
      wait: null,
      badYield: false,
    };
    agent.run = run;
    if ((plan.flags[i] as number) & (FLAG_GUIDE | FLAG_SNAPS)) this.#guideRuns++;
  }

  /**
   * Advances the agent's task to task time `tt`.
   * @returns True when the task ended in this call (the agent is free again).
   */
  step(agent: Agent, tt: number): boolean {
    const run = agent.run;
    if (!run) return true;
    const result = stepRun(agent, run, tt, this.#runHost);
    if (result === RUN_ACTIVE) return false;
    if (result === RUN_FAILED) closeRun(run, (error) => this.#host.fail(error, run.layer));
    else run.scope.dispose();
    this.#release(agent, run);
    this.#settle(agent, run.task, run.scope);
    return true;
  }

  /**
   * Stops the agent's task without completing it (replay, go live, finish now, destroy): its
   * generator is closed so `finally` blocks run, and overlays it left are removed.
   */
  abort(agent: Agent): void {
    const run = agent.run;
    if (!run) return;
    closeRun(run, (error) => this.#host.fail(error, run.layer));
    this.#release(agent, run);
    agent.role = null;
    agent.taskRng = null;
    agent.resetPose();
  }

  #release(agent: Agent, run: TaskRun): void {
    agent.run = null;
    if ((this.plan.flags[run.task] as number) & (FLAG_GUIDE | FLAG_SNAPS)) this.#guideRuns--;
  }

  /** Ends a task: final layer state, agent pose reset, dependents released. */
  #settle(agent: Agent, i: number, scope: ScopedStage): void {
    const layer = this.plan.layers[i] as Layer;
    if (!scope.finishedOwn) {
      try {
        this.#host.stage.finish(layer.id);
      } catch (error) {
        this.#host.fail(error, layer);
      }
    }
    agent.role = null;
    agent.taskRng = null;
    agent.resetPose();
    this.schedule.complete(i);
  }
}
