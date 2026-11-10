import type { Rect } from "../types";
import { type Agent, BENCHED, type EXITING, FADING, IDLE, type LEAVING, SWARM } from "./agent";
import { ALPHA_RATE, NONE_FADE_MS } from "./constants";
import { coast, steerTo } from "./steer";

/** Joiners appear this far outside the viewport edge. */
const ENTRY_MARGIN_PX = 40;
/** Leavers are benched once this far outside the viewport edge. */
const EXIT_MARGIN_PX = 36;
/** Wander area as viewport fractions. */
const WANDER_X0 = 0.18;
const WANDER_XS = 0.64;
const WANDER_Y0 = 0.22;
const WANDER_YS = 0.56;
const WANDER_SPEED_SHARE = 0.35;
const WANDER_ACCEL = 900;
const WANDER_SLOW_RADIUS = 120;
const ARRIVE_PX = 10;
/** Rest at a wander spot (and after a task) for MIN + rng * SPAN ms. */
const REST_MIN_MS = 400;
const REST_SPAN_MS = 1000;
const AFTER_TASK_REST_MIN_MS = 250;
const AFTER_TASK_REST_SPAN_MS = 600;
const REST_DAMPING_S = 0.12;
const EXIT_SPEED_SHARE = 1.25;
const EXIT_ACCEL = 2200;
/** Initial inward speed of a joiner, px/s. */
const ENTRY_SPEED = 220;

/**
 * Brings a benched agent into view from a side edge.
 * @param side -1 enters from the left edge, 1 from the right edge.
 * @param mode IDLE (building) or SWARM (intro, finale).
 */
export function joinAgent(agent: Agent, vp: Rect, side: -1 | 1, mode: typeof IDLE | typeof SWARM, sim: number): void {
  agent.side = side;
  agent.x = side < 0 ? vp.x - ENTRY_MARGIN_PX : vp.x + vp.w + ENTRY_MARGIN_PX;
  agent.y = vp.y + vp.h * (0.2 + 0.6 * agent.freeRng());
  agent.vx = -side * ENTRY_SPEED;
  agent.vy = 0;
  agent.heading = side < 0 ? 0 : Math.PI;
  agent.alpha = 0;
  agent.scale = 1;
  agent.mode = mode;
  agent.showHeading = mode === SWARM;
  agent.idleSince = sim;
  pickWanderTarget(agent);
  agent.holdUntil = 0;
}

/** Sends an agent out through the nearest side edge (LEAVING while building, EXITING on go live). */
export function sendAway(agent: Agent, vp: Rect, mode: typeof LEAVING | typeof EXITING): void {
  agent.side = agent.x < vp.x + vp.w / 2 ? -1 : 1;
  agent.mode = mode;
  agent.showHeading = false;
  agent.resetPose();
}

/** Marks an agent as resting after a task; it wanders off once the rest is over. */
export function restAfterTask(agent: Agent, sim: number): void {
  agent.mode = IDLE;
  agent.idleSince = sim;
  agent.vx = 0;
  agent.vy = 0;
  agent.holdUntil = sim + AFTER_TASK_REST_MIN_MS + agent.freeRng() * AFTER_TASK_REST_SPAN_MS;
}

function pickWanderTarget(agent: Agent): void {
  agent.targetX = WANDER_X0 + WANDER_XS * agent.freeRng();
  agent.targetY = WANDER_Y0 + WANDER_YS * agent.freeRng();
}

/** Idle motion: drift to a spot in the middle of the viewport, rest, pick another. */
export function wander(agent: Agent, vp: Rect, sim: number, h: number): void {
  if (agent.holdUntil > 0) {
    coast(agent, REST_DAMPING_S, h);
    if (sim >= agent.holdUntil) {
      pickWanderTarget(agent);
      agent.holdUntil = 0;
    }
    return;
  }
  const tx = vp.x + vp.w * agent.targetX;
  const ty = vp.y + vp.h * agent.targetY;
  if (Math.hypot(tx - agent.x, ty - agent.y) < ARRIVE_PX) {
    agent.holdUntil = sim + REST_MIN_MS + agent.freeRng() * REST_SPAN_MS;
    return;
  }
  steerTo(agent, tx, ty, agent.maxSpeed * WANDER_SPEED_SHARE, WANDER_ACCEL, WANDER_SLOW_RADIUS, h);
}

/** Moves a leaving / exiting agent toward its side edge; benches it once out of view. */
export function leave(agent: Agent, vp: Rect, h: number): void {
  const edge = agent.side < 0 ? vp.x - EXIT_MARGIN_PX : vp.x + vp.w + EXIT_MARGIN_PX;
  if (agent.side < 0 ? agent.x <= edge : agent.x >= edge) {
    bench(agent);
    return;
  }
  steerTo(agent, edge + agent.side * EXIT_MARGIN_PX * 2, agent.y, agent.maxSpeed * EXIT_SPEED_SHARE, EXIT_ACCEL, 1, h);
}

export function bench(agent: Agent): void {
  agent.mode = BENCHED;
  agent.alpha = 0;
  agent.vx = 0;
  agent.vy = 0;
  agent.slot = -1;
  agent.showHeading = false;
  agent.resetPose();
}

/** Fades visible agents in, FADING agents out (benching them at 0). `h` in seconds. */
export function updateAlpha(agent: Agent, h: number): void {
  if (agent.mode === BENCHED) return;
  if (agent.mode === FADING) {
    agent.alpha -= (h * 1000) / NONE_FADE_MS;
    if (agent.alpha <= 0) bench(agent);
    return;
  }
  if (agent.alpha < 1) agent.alpha = Math.min(1, agent.alpha + ALPHA_RATE * h);
}
