import type { Ease } from "../types";

/** Maps normalized time 0..1 to progress (0 at t=0, 1 at t=1; may overshoot in between). */
export type EaseFn = (t: number) => number;

export const linear: EaseFn = (t) => t;

/**
 * Minimum-jerk profile (10t^3 - 15t^4 + 6t^5): the bell-shaped velocity of a human reach.
 * Continuous in position, velocity and acceleration, with zero velocity at both ends.
 */
export const minJerk: EaseFn = (t) => t * t * t * (10 + t * (-15 + 6 * t));

export const easeIn: EaseFn = (t) => t * t * t;

export const easeOut: EaseFn = (t) => {
  const u = 1 - t;
  return 1 - u * u * u;
};

/**
 * Damped spring that overshoots about 13% once and lands exactly on 1 at t=1
 * (cos(2.5 pi) = 0), so the final snap to the target is seamless.
 */
export const spring: EaseFn = (t) => 1 - Math.cos(t * 2.5 * Math.PI) * Math.exp(-5 * t);

/** Easing for a contract {@link Ease} name; `undefined` and "inOut" use {@link minJerk}. */
export function easeFor(ease: Ease | undefined): EaseFn {
  switch (ease) {
    case "linear":
      return linear;
    case "in":
      return easeIn;
    case "out":
      return easeOut;
    case "spring":
      return spring;
    default:
      return minJerk;
  }
}

const BUMP_POWER = 10;
const BUMP_PEAK_T = BUMP_POWER / (BUMP_POWER + 2);
const BUMP_MAX = BUMP_PEAK_T ** BUMP_POWER * (1 - BUMP_PEAK_T) ** 2;

/**
 * Smooth bump t^10 (1-t)^2, normalized to peak 1 at t = 5/6, zero value and slope at t=1.
 * Added to an ease it produces a small overshoot that settles back onto the target.
 */
export function overshootBump(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const u = 1 - t;
  return (t ** BUMP_POWER * u * u) / BUMP_MAX;
}

/** Point on the quadratic Bezier p0 -> c -> p1 at parameter s (s may leave 0..1 slightly). */
export function quadAt(p0: number, c: number, p1: number, s: number): number {
  const u = 1 - s;
  return u * u * p0 + 2 * u * s * c + s * s * p1;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
