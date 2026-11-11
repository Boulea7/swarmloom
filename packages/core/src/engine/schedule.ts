import type { Rect } from "../types";
import { IndexHeap } from "./heap";
import { FLAG_GATE, FLAG_GUIDE, type Plan } from "./planner";

/** Task status values. */
export const WAITING = 0;
export const LOCKED = 1;
export const AVAILABLE = 2;
export const RUNNING = 3;
export const DONE = 4;

/* Pick scoring (lower is better). Tiers dominate position. */
const TIER_WEIGHT = 1e9;
/** Reading position weight of x relative to y inside the viewport. */
const X_WEIGHT = 0.2;
/** Weight of the agent's distance to the task. */
const DISTANCE_WEIGHT = 0.5;
/** Guides jump ahead by this many viewport heights. */
const GUIDE_BONUS_VIEWPORTS = 2;

/**
 * Runtime state of a {@link Plan}: dependency counts, the unlock boundary, the set of tasks an
 * idle agent may take, and aggregates for progress, ETA and the tour.
 *
 * A task whose dependencies are done is available when its `unlockY` is within the boundary,
 * otherwise it waits in a heap ordered by `unlockY`. Agents only pick available tasks in sight.
 * Completing a task wakes only its direct dependents (gates complete in the same cascade), so no
 * step scans the whole graph.
 */
export class Schedule {
  readonly plan: Plan;
  readonly status: Uint8Array;
  readonly #remaining: Int32Array;
  readonly #avail: Int32Array;
  readonly #availPos: Int32Array;
  #availCount = 0;
  readonly #locked: IndexHeap;
  readonly #stack: Int32Array;
  #boundary = Number.NEGATIVE_INFINITY;
  #built = 0;
  #topCursor = 0;
  #remainingEstimate = 0;
  #availableEstimate = 0;

  constructor(plan: Plan) {
    this.plan = plan;
    this.status = new Uint8Array(plan.nodeCount);
    this.#remaining = new Int32Array(plan.nodeCount);
    this.#avail = new Int32Array(Math.max(1, plan.taskCount));
    this.#availPos = new Int32Array(plan.nodeCount);
    this.#locked = new IndexHeap(plan.nodeCount, plan.unlockY);
    this.#stack = new Int32Array(Math.max(1, plan.nodeCount));
    this.reset();
  }

  /** Back to the initial state (nothing built, boundary closed). */
  reset(): void {
    const { plan } = this;
    this.status.fill(WAITING);
    this.#remaining.set(plan.deps);
    this.#availCount = 0;
    this.#locked.clear();
    this.#boundary = Number.NEGATIVE_INFINITY;
    this.#built = 0;
    this.#topCursor = 0;
    this.#remainingEstimate = plan.totalEstimate;
    this.#availableEstimate = 0;
    for (let v = 0; v < plan.nodeCount; v++) {
      if (plan.deps[v] === 0) this.#cascade(v, false);
    }
  }

  /** Layer tasks completed. */
  get built(): number {
    return this.#built;
  }

  get total(): number {
    return this.plan.taskCount;
  }

  get done(): boolean {
    return this.#built === this.plan.taskCount;
  }

  /** Tasks an idle agent could take right now. */
  get available(): number {
    return this.#availCount;
  }

  /** Tasks whose dependencies are done but that wait below the unlock boundary. */
  get locked(): number {
    return this.#locked.size;
  }

  /** Unlock position of the first task waiting below the boundary; +Infinity when none waits. */
  nextLockedY(): number {
    return this.#locked.size > 0 ? (this.plan.unlockY[this.#locked.peek()] as number) : Number.POSITIVE_INFINITY;
  }

  get boundary(): number {
    return this.#boundary;
  }

  /** Sum of estimates of tasks not completed (running ones included in full). */
  get remainingEstimate(): number {
    return this.#remainingEstimate;
  }

  /** Sum of estimates of available tasks (work an idle crew could start now). */
  get availableEstimate(): number {
    return Math.max(this.#availableEstimate, 0);
  }

  /** Moves the unlock boundary down (it never moves up) and releases tasks above it. */
  setBoundary(y: number): void {
    if (!(y > this.#boundary)) return;
    this.#boundary = y;
    const unlockY = this.plan.unlockY;
    while (this.#locked.size > 0 && (unlockY[this.#locked.peek()] as number) <= y) {
      const v = this.#locked.pop();
      // Tasks completed while locked (go live, aborts) stay done.
      if (this.status[v] === LOCKED) this.#addAvailable(v);
    }
  }

  /** True when task `i` can be seen in the vertical span [top, bottom] (or needs no gesture at all). */
  #inSight(i: number, top: number, bottom: number): boolean {
    const sh = this.plan.seenH[i] as number;
    if (sh < 0) return true;
    const sy = this.plan.seenY[i] as number;
    return sy <= bottom && sy + sh >= top;
  }

  /**
   * Best available task in sight for an agent at (ax, ay), or -1. Only tasks whose visible part
   * intersects the viewport qualify: the swarm never works on what nobody can see (the engine
   * fades such layers in without cursors instead). Guides first, then reading position plus
   * distance; priority tiers order everything.
   */
  pick(ax: number, ay: number, vp: Rect): number {
    const { x, seenY, tier, flags } = this.plan;
    const top = vp.y;
    const bottom = vp.y + vp.h;
    const guideBonus = GUIDE_BONUS_VIEWPORTS * Math.max(1, vp.h);
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let k = 0; k < this.#availCount; k++) {
      const i = this.#avail[k] as number;
      if (!this.#inSight(i, top, bottom)) continue;
      const anchorY = Math.max(seenY[i] as number, top);
      const tx = x[i] as number;
      const dx = tx - ax;
      const dy = anchorY - ay;
      let score = anchorY - top + tx * X_WEIGHT + Math.sqrt(dx * dx + dy * dy) * DISTANCE_WEIGHT;
      if ((flags[i] as number) & FLAG_GUIDE) score -= guideBonus;
      score += (tier[i] as number) * TIER_WEIGHT;
      if (score < bestScore || (score === bestScore && i < best)) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** True when an available task is in sight of `vp` (what {@link pick} could return). */
  hasWorkInSight(vp: Rect): boolean {
    const top = vp.y;
    const bottom = vp.y + vp.h;
    for (let k = 0; k < this.#availCount; k++) {
      if (this.#inSight(this.#avail[k] as number, top, bottom)) return true;
    }
    return false;
  }

  /**
   * Estimates of the unfinished tasks in sight of `vp`, and whether any unfinished task lies out
   * of sight. One pass over the tasks; meant for ETA polling, not for every frame.
   */
  remainingInSight(vp: Rect): { estimate: number; outside: boolean } {
    const { taskCount, estimate } = this.plan;
    const top = vp.y;
    const bottom = vp.y + vp.h;
    let sum = 0;
    let outside = false;
    for (let i = 0; i < taskCount; i++) {
      if (this.status[i] === DONE) continue;
      if (this.#inSight(i, top, bottom)) sum += estimate[i] as number;
      else outside = true;
    }
    return { estimate: sum, outside };
  }

  /** Marks an available task as taken by an agent. */
  start(i: number): void {
    if (this.status[i] !== AVAILABLE) throw new Error(`task ${i} is not available`);
    this.#removeAvailable(i);
    this.status[i] = RUNNING;
  }

  /**
   * Marks a task done and wakes its dependents. Accepts tasks in any state so aborts and
   * failures can still release the graph; completing a done task is a no-op.
   * @returns Whether the task was not done before.
   */
  complete(i: number): boolean {
    const s = this.status[i];
    if (s === DONE) return false;
    if (s === AVAILABLE) this.#removeAvailable(i);
    this.#cascade(i, true);
    return true;
  }

  /** Marks every task done (go live, skip). */
  finishAll(): void {
    const { plan } = this;
    this.#availCount = 0;
    this.#availableEstimate = 0;
    this.#locked.clear();
    for (let v = 0; v < plan.nodeCount; v++) this.status[v] = DONE;
    this.#built = plan.taskCount;
    this.#remainingEstimate = 0;
    this.#topCursor = plan.byTop.length;
  }

  /**
   * Top edge of the earliest (by top edge) task that is not done and does not end above
   * `fromY`; +Infinity when there is none. Unfinished work the viewer scrolled past does not
   * hold the tour back (it fades in once the crew runs out of work in sight).
   */
  frontier(fromY = Number.NEGATIVE_INFINITY): number {
    const { byTop, y, h } = this.plan;
    while (this.#topCursor < byTop.length && this.status[byTop[this.#topCursor] as number] === DONE) {
      this.#topCursor++;
    }
    for (let k = this.#topCursor; k < byTop.length; k++) {
      const i = byTop[k] as number;
      if (this.status[i] !== DONE && (y[i] as number) + (h[i] as number) > fromY) return y[i] as number;
    }
    return Number.POSITIVE_INFINITY;
  }

  /**
   * Runs `v` through "ready" (or straight to done when `finished`) and propagates completion
   * through dependents and gates iteratively.
   */
  #cascade(v: number, finished: boolean): void {
    const { plan } = this;
    const stack = this.#stack;
    let sp = 0;
    if (finished || (plan.flags[v] as number) & FLAG_GATE) stack[sp++] = v;
    else this.#ready(v);
    while (sp > 0) {
      const u = stack[--sp] as number;
      this.status[u] = DONE;
      if (u < plan.taskCount) {
        this.#built++;
        this.#remainingEstimate -= plan.estimate[u] as number;
      }
      const end = plan.outStart[u + 1] as number;
      for (let k = plan.outStart[u] as number; k < end; k++) {
        const d = plan.outList[k] as number;
        const left = (this.#remaining[d] as number) - 1;
        this.#remaining[d] = left;
        if (left !== 0 || this.status[d] === DONE) continue;
        if ((plan.flags[d] as number) & FLAG_GATE) stack[sp++] = d;
        else this.#ready(d);
      }
    }
    if (this.#built === plan.taskCount) this.#remainingEstimate = 0;
  }

  #ready(v: number): void {
    if ((this.plan.unlockY[v] as number) <= this.#boundary) this.#addAvailable(v);
    else {
      this.status[v] = LOCKED;
      this.#locked.push(v);
    }
  }

  #addAvailable(v: number): void {
    this.status[v] = AVAILABLE;
    this.#availableEstimate += this.plan.estimate[v] as number;
    this.#availPos[v] = this.#availCount;
    this.#avail[this.#availCount++] = v;
  }

  #removeAvailable(v: number): void {
    this.#availableEstimate -= this.plan.estimate[v] as number;
    const at = this.#availPos[v] as number;
    const last = this.#avail[--this.#availCount] as number;
    this.#avail[at] = last;
    this.#availPos[last] = at;
  }
}
