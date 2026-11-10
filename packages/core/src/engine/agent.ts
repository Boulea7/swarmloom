import type { AgentView } from "../internal";
import type { AgentApi, CursorShape, Ease, Rng, SoundName, TaskGen } from "../types";
import {
  BEND_SHARE,
  DRAG_BASE_MS,
  DRAG_MAX_MS,
  DRAG_MIN_MS,
  DRAG_PER_SQRT_PX,
  MAX_BEND_PX,
  MAX_OVERSHOOT_PX,
  MOVE_BASE_MS,
  MOVE_MAX_MS,
  MOVE_MIN_MS,
  MOVE_PER_SQRT_PX,
  OVERSHOOT_SHARE,
  SNAP_DISTANCE_PX,
} from "./constants";
import { clamp, easeFor, overshootBump, quadAt } from "./easing";
import type { RoleKey } from "./labels";
import type { TaskRun } from "./runner";

/* Agent modes. Only WORKING agents are moved by a task generator; the rest move by steering. */
/** Off screen, invisible, not part of the crew. */
export const BENCHED = 0;
/** In the crew without a task: wanders near the work. */
export const IDLE = 1;
/** Driven by a task generator. */
export const WORKING = 2;
/** Extra agent leaving through a side edge after being idle for a while. */
export const LEAVING = 3;
/** Collective motion: intro shuttle or finale (flock / halo). */
export const SWARM = 4;
/** Go live: leaving through the nearest side edge. */
export const EXITING = 5;
/** Finale "none": fading out in place. */
export const FADING = 6;

export type AgentMode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Engine services an agent needs. */
export interface AgentHost {
  emitSound(agent: Agent, name: SoundName, opts?: { pitch?: number; vel?: number }): void;
}

const CURSOR_SHAPES: ReadonlySet<string> = new Set<CursorShape>([
  "arrow",
  "crosshair",
  "ibeam",
  "pen",
  "hand",
  "grab",
  "move",
  "copy",
  "resize",
]);

/** Longest status bubble kept (longer text is cut). */
const MAX_BUBBLE_CHARS = 48;
/** Highest free-motion speed carried into the first move of a task, px/s. */
const MAX_CARRY_SPEED = 600;

type TravelOptions = { dur?: number; ease?: Ease };

/**
 * One cursor: implements the choreography-facing {@link AgentApi}, carries its free-motion
 * state and a reusable {@link AgentView} for the stage.
 *
 * Each agent has its own seeded rng and a small movement personality (pace, top speed, orbit
 * radius and speed) so a crowd never moves in lockstep.
 */
export class Agent implements AgentApi {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  /** Stream for free motion (wander, entry points); independent of task randomness. */
  readonly freeRng: Rng;
  /** Stream of the running task (derived from its layer id), so a layer's variation does not depend on which agent builds it. */
  taskRng: Rng | null = null;

  x = 0;
  y = 0;
  /** Free-motion velocity, px/s. Zeroed while a task drives the agent. */
  vx = 0;
  vy = 0;
  shape: CursorShape = "arrow";
  pressed = false;
  bubble = "";
  label = "";
  alpha = 0;
  scale = 1;
  /** Heading in radians; published as AgentView.angle while `showHeading`. */
  heading = 0;
  showHeading = false;

  mode: AgentMode = BENCHED;
  /** Role of the running task ("roles" label mode), null while not working. */
  role: RoleKey | null = null;
  /** Task time seen by the running generator ({@link now}). */
  localTime = 0;
  run: TaskRun | null = null;
  /** Player time when the agent last became idle. */
  idleSince = 0;
  /** Free-motion target: viewport fractions for wandering, stage px otherwise. */
  targetX = 0;
  targetY = 0;
  /** Physics time until which the current wander target is kept. */
  holdUntil = 0;
  /** Side edge used to enter or leave: -1 left, 1 right. */
  side: -1 | 1 = 1;
  /** Halo slot while in the halo formation, else -1. */
  slot = -1;

  /** Travel time multiplier (about a quarter of the crew is quick). */
  readonly pace: number;
  /** Free-motion top speed, px/s. */
  readonly maxSpeed: number;
  /** Swarm personality: ring radius and speed multipliers, phase (rad) and turning direction (intro lane and pass, finale orbit). */
  readonly orbitRadius: number;
  readonly orbitSpeed: number;
  readonly orbitPhase: number;
  readonly swirl: 1 | -1;

  readonly view: AgentView;
  readonly #host: AgentHost;

  /**
   * @param rng Agent stream: draws the movement personality, then drives free motion.
   */
  constructor(id: number, name: string, color: string, rng: Rng, host: AgentHost) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.freeRng = rng;
    this.#host = host;
    const quick = rng() < 0.25;
    this.pace = quick ? 0.78 + rng() * 0.1 : 0.92 + rng() * 0.28;
    this.maxSpeed = (quick ? 520 : 380) + rng() * 120;
    this.orbitRadius = 0.75 + rng() * 0.5;
    this.orbitSpeed = 0.8 + rng() * 0.7;
    this.orbitPhase = rng() * Math.PI * 2;
    this.swirl = rng() < 0.8 ? 1 : -1;
    this.view = {
      id,
      name,
      label: "",
      color,
      x: 0,
      y: 0,
      shape: "arrow",
      pressed: false,
      bubble: "",
      alpha: 0,
      scale: 1,
    };
  }

  /** Randomness for choreographies: the running task's stream, else the agent's own. */
  get rng(): Rng {
    return this.taskRng ?? this.freeRng;
  }

  /**
   * Travels to (x, y) along a slightly bent path with a human-like velocity profile and, for
   * default-eased moves, a tiny overshoot that settles on the target.
   * @throws RangeError for non-finite coordinates or durations.
   */
  moveTo(x: number, y: number, opts?: TravelOptions): TaskGen {
    return travel(this, x, y, opts, false);
  }

  /** Like {@link moveTo} but straight and without overshoot (sizes stay readable while dragging). */
  dragTo(x: number, y: number, opts?: TravelOptions): TaskGen {
    return travel(this, x, y, opts, true);
  }

  press(): void {
    this.pressed = true;
  }

  release(): void {
    this.pressed = false;
  }

  setCursor(shape: CursorShape): void {
    this.shape = CURSOR_SHAPES.has(shape) ? shape : "arrow";
  }

  say(text: string): void {
    this.bubble = typeof text === "string" ? text.slice(0, MAX_BUBBLE_CHARS) : "";
  }

  sound(name: SoundName, opts?: { pitch?: number; vel?: number }): void {
    this.#host.emitSound(this, name, opts);
  }

  /** Current task time in engine ms (speed applied): the timeline yielded waits are measured in. */
  now(): number {
    return this.localTime;
  }

  /** Clears transient task state (button, tool, bubble). */
  resetPose(): void {
    this.pressed = false;
    this.shape = "arrow";
    this.bubble = "";
  }

  /** Copies the current state into {@link view} (no allocation). */
  syncView(): AgentView {
    const v = this.view;
    v.label = this.label;
    v.x = this.x;
    v.y = this.y;
    v.shape = this.shape;
    v.pressed = this.pressed;
    v.bubble = this.bubble;
    v.alpha = this.alpha;
    v.scale = this.scale;
    v.angle = this.showHeading ? this.heading : undefined;
    return v;
  }
}

/** Default travel time for a distance, scaled by the agent's pace. */
export function travelDuration(distance: number, drag: boolean, pace: number): number {
  const root = Math.sqrt(Math.max(0, distance));
  return drag
    ? clamp((DRAG_BASE_MS + DRAG_PER_SQRT_PX * root) * pace, DRAG_MIN_MS, DRAG_MAX_MS)
    : clamp((MOVE_BASE_MS + MOVE_PER_SQRT_PX * root) * pace, MOVE_MIN_MS, MOVE_MAX_MS);
}

function* travel(agent: Agent, tx: number, ty: number, opts: TravelOptions | undefined, drag: boolean): TaskGen {
  const verb = drag ? "dragTo" : "moveTo";
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
    throw new RangeError(`${verb}() needs finite coordinates, got (${tx}, ${ty})`);
  }
  const explicit = opts?.dur;
  if (explicit !== undefined && !(Number.isFinite(explicit) && explicit >= 0)) {
    throw new RangeError(`${verb}() needs a finite dur >= 0, got ${explicit}`);
  }
  // Draw randomness up front so the rng sequence never depends on frame timing.
  const bendDraw = agent.rng();
  const overshootDraw = agent.rng();
  const x0 = agent.x;
  const y0 = agent.y;
  const dx = tx - x0;
  const dy = ty - y0;
  const dist = Math.hypot(dx, dy);
  // Velocity carried over from free motion blends out over the move (no dead stop at the start).
  let carryX = agent.vx;
  let carryY = agent.vy;
  agent.vx = 0;
  agent.vy = 0;
  if (explicit === 0 || (explicit === undefined && dist < SNAP_DISTANCE_PX)) {
    agent.x = tx;
    agent.y = ty;
    return;
  }
  const dur = explicit ?? travelDuration(dist, drag, agent.pace);
  const ease = easeFor(opts?.ease);
  let cx = x0 + dx / 2;
  let cy = y0 + dy / 2;
  let over = 0;
  if (!drag && dist > 0) {
    const bend = (bendDraw * 2 - 1) * Math.min(MAX_BEND_PX, dist * BEND_SHARE);
    cx -= (dy / dist) * bend;
    cy += (dx / dist) * bend;
    if (opts?.ease === undefined) over = (overshootDraw * Math.min(MAX_OVERSHOOT_PX, dist * OVERSHOOT_SHARE)) / dist;
  }
  const carrySpeed = Math.hypot(carryX, carryY);
  if (carrySpeed > MAX_CARRY_SPEED) {
    carryX *= MAX_CARRY_SPEED / carrySpeed;
    carryY *= MAX_CARRY_SPEED / carrySpeed;
  }
  const carryScale = dur / 1000;
  const start = agent.localTime;
  for (;;) {
    const t = (agent.localTime - start) / dur;
    if (t >= 1) {
      agent.x = tx;
      agent.y = ty;
      return;
    }
    const s = ease(t) + over * overshootBump(t);
    // t (1 - t)^2 starts with slope 1 (matches the carried velocity) and ends flat at 0.
    const carry = t * (1 - t) * (1 - t) * carryScale;
    agent.x = quadAt(x0, cx, tx, s) + carryX * carry;
    agent.y = quadAt(y0, cy, ty, s) + carryY * carry;
    yield undefined;
  }
}
