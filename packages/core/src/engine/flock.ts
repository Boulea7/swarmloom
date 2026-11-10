import type { Point, Rect } from "../types";
import { type Agent, SWARM } from "./agent";
import { SpatialHash } from "./spatial-hash";
import { applySteer } from "./steer";

/** Neighbour radius for alignment and cohesion (also the hash cell size). */
export const NEIGHBOR_RADIUS = 90;
/** Agents closer than this push apart. */
const SEPARATION_RADIUS = 30;
/** Hard keep-out circle around the pointer. */
export const POINTER_AVOID_RADIUS = 48;
/** Orbit radius around the pointer / wander point at orbitRadius 1. */
const POINTER_ORBIT_PX = 78;
const WANDER_ORBIT_PX = 120;
/** Tangential orbit speed at orbitSpeed 1, px/s. */
const ORBIT_TANGENT_PX_S = 150;
/** Radial correction gain toward the orbit ring, 1/s. */
const RING_GAIN = 2.2;
const ACCEL = 1700;
const W_SEEK = 1;
const W_SEPARATION = 1.6;
const W_ALIGNMENT = 0.35;
const W_COHESION = 0.15;
/** Minimum outward speed after being pushed out of the pointer circle, px/s. */
const AVOID_KICK_PX_S = 140;
const MAX_NEIGHBORS = 64;

/**
 * Finale "flock": boids around a moving target. Each member orbits the pointer (or, without a
 * pointer, a point drifting around the viewport centre on two slow periods) on its own ring,
 * with separation, alignment and cohesion from neighbours found through a {@link SpatialHash}.
 * Neighbour forces read a snapshot of the previous step, so the result does not depend on the
 * update order.
 */
export class Flock {
  readonly #hash = new SpatialHash(NEIGHBOR_RADIUS, MAX_NEIGHBORS);
  readonly #members: Agent[] = [];
  readonly #neighbors = new Int32Array(MAX_NEIGHBORS);
  #px = new Float64Array(MAX_NEIGHBORS);
  #py = new Float64Array(MAX_NEIGHBORS);
  #pvx = new Float64Array(MAX_NEIGHBORS);
  #pvy = new Float64Array(MAX_NEIGHBORS);

  /** The point the flock circles: the pointer, or the drifting wander point. */
  target(pointer: Point | null, vp: Rect, pt: number, out: Point): Point {
    if (pointer) {
      out.x = pointer.x;
      out.y = pointer.y;
      return out;
    }
    const s = pt / 1000;
    out.x = vp.x + vp.w / 2 + Math.sin(s * 0.37) * vp.w * 0.16;
    out.y = vp.y + vp.h / 2 + Math.sin(s * 0.53 + 1.3) * vp.h * 0.14;
    return out;
  }

  /** One physics step of `h` seconds for every agent in SWARM mode. */
  step(agents: readonly Agent[], target: Point, hasPointer: boolean, pt: number, h: number): void {
    const members = this.#members;
    members.length = 0;
    for (const a of agents) if (a.mode === SWARM) members.push(a);
    const n = members.length;
    if (n === 0) return;
    this.#ensure(n);
    const px = this.#px;
    const py = this.#py;
    const pvx = this.#pvx;
    const pvy = this.#pvy;
    for (let i = 0; i < n; i++) {
      const a = members[i] as Agent;
      px[i] = a.x;
      py[i] = a.y;
      pvx[i] = a.vx;
      pvy[i] = a.vy;
    }
    this.#hash.rebuild(px, py, n);
    const ringBase = hasPointer ? POINTER_ORBIT_PX : WANDER_ORBIT_PX;
    const s = pt / 1000;
    const sep2 = SEPARATION_RADIUS * SEPARATION_RADIUS;
    for (let i = 0; i < n; i++) {
      const a = members[i] as Agent;
      const x = px[i] as number;
      const y = py[i] as number;
      const vx = pvx[i] as number;
      const vy = pvy[i] as number;
      const maxSpeed = a.maxSpeed;

      // Orbit: radial correction toward the agent's ring plus a tangential swirl.
      let rx = x - target.x;
      let ry = y - target.y;
      let d = Math.hypot(rx, ry);
      if (d < 1e-3) {
        rx = Math.cos(a.orbitPhase);
        ry = Math.sin(a.orbitPhase);
        d = 1;
      }
      const ux = rx / d;
      const uy = ry / d;
      const ring = ringBase * a.orbitRadius * (1 + 0.12 * Math.sin(s * 0.9 + a.orbitPhase));
      const radial = Math.max(-maxSpeed, Math.min(maxSpeed, (ring - d) * RING_GAIN));
      const tangent = ORBIT_TANGENT_PX_S * a.orbitSpeed * a.swirl;
      let sx = (ux * radial - uy * tangent - vx) * W_SEEK;
      let sy = (uy * radial + ux * tangent - vy) * W_SEEK;

      const count = this.#hash.query(x, y, NEIGHBOR_RADIUS, this.#neighbors);
      let sepX = 0;
      let sepY = 0;
      let aliX = 0;
      let aliY = 0;
      let cohX = 0;
      let cohY = 0;
      let others = 0;
      for (let k = 0; k < count; k++) {
        const j = this.#neighbors[k] as number;
        if (j === i) continue;
        const dx = x - (px[j] as number);
        const dy = y - (py[j] as number);
        const d2 = dx * dx + dy * dy;
        if (d2 < sep2 && d2 > 1e-6) {
          sepX += dx / d2;
          sepY += dy / d2;
        }
        aliX += pvx[j] as number;
        aliY += pvy[j] as number;
        cohX += px[j] as number;
        cohY += py[j] as number;
        others++;
      }
      const sepLen = Math.hypot(sepX, sepY);
      if (sepLen > 0) {
        sx += ((sepX / sepLen) * maxSpeed - vx) * W_SEPARATION;
        sy += ((sepY / sepLen) * maxSpeed - vy) * W_SEPARATION;
      }
      if (others > 0) {
        sx += (aliX / others - vx) * W_ALIGNMENT;
        sy += (aliY / others - vy) * W_ALIGNMENT;
        sx += (cohX / others - x - vx) * W_COHESION;
        sy += (cohY / others - y - vy) * W_COHESION;
      }
      applySteer(a, sx, sy, ACCEL, maxSpeed, h);

      if (hasPointer) keepOut(a, target);
    }
  }

  #ensure(n: number): void {
    if (this.#px.length >= n) return;
    const size = Math.max(n, this.#px.length * 2);
    this.#px = new Float64Array(size);
    this.#py = new Float64Array(size);
    this.#pvx = new Float64Array(size);
    this.#pvy = new Float64Array(size);
  }
}

/** Pushes an agent inside the pointer circle back to its edge with an outward kick. */
function keepOut(a: Agent, center: Point): void {
  const dx = a.x - center.x;
  const dy = a.y - center.y;
  const d = Math.hypot(dx, dy);
  if (d >= POINTER_AVOID_RADIUS) return;
  const ux = d > 1e-3 ? dx / d : Math.cos(a.orbitPhase);
  const uy = d > 1e-3 ? dy / d : Math.sin(a.orbitPhase);
  a.x = center.x + ux * POINTER_AVOID_RADIUS;
  a.y = center.y + uy * POINTER_AVOID_RADIUS;
  const outward = a.vx * ux + a.vy * uy;
  if (outward < AVOID_KICK_PX_S) {
    a.vx += (AVOID_KICK_PX_S - outward) * ux;
    a.vy += (AVOID_KICK_PX_S - outward) * uy;
  }
}
