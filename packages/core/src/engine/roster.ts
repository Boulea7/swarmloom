import type { AgentView } from "../internal";
import type { Point, Rect } from "../types";
import { Agent, type AgentHost, BENCHED, EXITING, FADING, IDLE, LEAVING, type SWARM, WORKING } from "./agent";
import { JOIN_COOLDOWN_MS, RETIRE_IDLE_MS } from "./constants";
import { bench, joinAgent, leave, sendAway, updateAlpha, wander } from "./crew";
import type { Labeler } from "./labels";
import { coast } from "./steer";
import { streamRng } from "./streams";

/** Damping of agents fading out in place (finale "none"), seconds. */
const FADE_DAMPING_S = 0.2;
const FALLBACK_COLOR = "#5B5BF7";

export interface RosterOptions {
  count: number;
  /** Agents `0..base-1` never retire while building. */
  base: number;
  seed: number;
  palette: readonly string[];
  labeler: Labeler;
  host: AgentHost;
}

/**
 * The pool of cursors: creates them with their own seeded streams, brings them in and out of
 * view, moves the ones no task drives, and publishes the per-frame {@link AgentView} list.
 * Agents join in index order, so the same seed always shows the same faces first.
 */
export class Roster {
  readonly agents: readonly Agent[];
  readonly base: number;
  readonly #labeler: Labeler;
  readonly #views: AgentView[] = [];
  readonly #point: Point = { x: 0, y: 0 };
  #lastJoin = Number.NEGATIVE_INFINITY;

  constructor(opts: RosterOptions) {
    const palette = opts.palette.length > 0 ? opts.palette : [FALLBACK_COLOR];
    this.#labeler = opts.labeler;
    this.base = Math.min(opts.base, opts.count);
    this.agents = Array.from({ length: opts.count }, (_, i) => {
      const agent = new Agent(
        i,
        opts.labeler.name(i),
        palette[i % palette.length] as string,
        streamRng(opts.seed, `agent:${i}`),
        opts.host,
      );
      agent.label = opts.labeler.label(i, null);
      return agent;
    });
  }

  /** Agents in view that are not on their way out. */
  activeCount(): number {
    let n = 0;
    for (const a of this.agents) {
      if (a.mode !== BENCHED && a.mode !== LEAVING && a.mode !== EXITING && a.mode !== FADING) n++;
    }
    return n;
  }

  /**
   * Brings the lowest-index benched agent in from a seeded side edge, at most one per
   * `cooldownMs` of `sim` time.
   * @returns The joined agent, or null (cooldown, nobody benched).
   */
  join(mode: typeof IDLE | typeof SWARM, vp: Rect, sim: number, cooldownMs = JOIN_COOLDOWN_MS): Agent | null {
    if (sim - this.#lastJoin < cooldownMs) return null;
    for (const a of this.agents) {
      if (a.mode !== BENCHED) continue;
      joinAgent(a, vp, a.freeRng() < 0.5 ? -1 : 1, mode, sim);
      this.#lastJoin = sim;
      return a;
    }
    return null;
  }

  /**
   * Grows the building crew toward `target` (recalling leavers first) or retires one extra
   * agent that has been idle for a while. At most one change per call.
   */
  balance(target: number, vp: Rect, sim: number): void {
    const active = this.activeCount();
    if (active < target) {
      for (const a of this.agents) {
        if (a.mode === LEAVING) {
          a.mode = IDLE;
          a.idleSince = sim;
          return;
        }
      }
      this.join(IDLE, vp, sim);
      return;
    }
    if (active <= target) return;
    let pick: Agent | null = null;
    for (let i = this.agents.length - 1; i >= this.base; i--) {
      const a = this.agents[i] as Agent;
      if (a.mode !== IDLE || sim - a.idleSince < RETIRE_IDLE_MS) continue;
      if (!pick || a.idleSince < pick.idleSince) pick = a;
    }
    if (pick) sendAway(pick, vp, LEAVING);
  }

  /** One physics step (`h` s) for agents no task or swarm controller drives. */
  stepFree(vp: Rect, sim: number, h: number): void {
    for (const a of this.agents) {
      switch (a.mode) {
        case BENCHED:
          continue;
        case IDLE:
          wander(a, vp, sim, h);
          break;
        case LEAVING:
        case EXITING:
          leave(a, vp, h);
          break;
        case FADING:
          coast(a, FADE_DAMPING_S, h);
          break;
        default:
          break;
      }
      updateAlpha(a, h);
    }
  }

  /** Benches everyone at once (reduced motion, destroy). */
  benchAll(): void {
    for (const a of this.agents) bench(a);
  }

  /** Agents currently driven by a task. */
  workingCount(): number {
    let n = 0;
    for (const a of this.agents) if (a.mode === WORKING) n++;
    return n;
  }

  /**
   * Views of visible agents for the stage. View objects are reused (no allocation per frame).
   * @param project Optional stage-to-screen projection from a plugin (3D scenes).
   */
  views(project: ((p: Point) => Point) | null): readonly AgentView[] {
    const out = this.#views;
    out.length = 0;
    for (const a of this.agents) {
      if (a.mode === BENCHED || a.alpha <= 0) continue;
      a.label = this.#labeler.label(a.id, a.role);
      const view = a.syncView();
      if (project) {
        this.#point.x = a.x;
        this.#point.y = a.y;
        const p = project(this.#point);
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          view.x = p.x;
          view.y = p.y;
        }
      }
      out.push(view);
    }
    return out;
  }
}
