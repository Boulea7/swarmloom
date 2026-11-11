import type { Rect } from "../types";
import { SCROLL_SMOOTH_MS, TOUR_GAIN, TOUR_HOLD_MS, TOUR_LEAD_SHARE, TOUR_MAX_PX_S, TOUR_SMOOTH_MS } from "./constants";
import { clamp } from "./easing";

/** Tour speed cap grows with build speed up to this multiplier. */
const TOUR_SPEED_SCALE_MAX = 3;

/**
 * Follows the viewport: estimates the user's scroll speed (frame-rate independent exponential
 * smoothing) and drives the tour, an auto-scroll that keeps the earliest unfinished layer a
 * little below the top edge (closer to it while the crew waits for work to come into view).
 * The tour only scrolls down, never past that layer (so it never outruns the swarm), eases its
 * speed, keeps sub-pixel progress and yields to user scrolls.
 */
export class Camera {
  /** Smoothed user scroll speed, px/s. */
  scrollSpeed = 0;
  #lastY = Number.NaN;
  #tourY = Number.NaN;
  #tourV = 0;
  /** Player time until which the tour yields to the user. */
  #holdUntil = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.scrollSpeed = 0;
    this.#lastY = Number.NaN;
    this.#tourY = Number.NaN;
    this.#tourV = 0;
    this.#holdUntil = Number.NEGATIVE_INFINITY;
  }

  /** Records a user scroll: the tour pauses briefly and continues from there. */
  userScrolled(y: number, pt: number): void {
    this.#holdUntil = pt + TOUR_HOLD_MS;
    this.#tourY = y;
    this.#tourV = 0;
  }

  /** Updates the scroll speed estimate from the viewport position of this frame. */
  track(vp: Rect, dtMs: number, countAsUser: boolean): void {
    const y = vp.y;
    if (Number.isNaN(this.#lastY) || dtMs <= 0) {
      this.#lastY = y;
      return;
    }
    const instant = countAsUser ? (Math.abs(y - this.#lastY) * 1000) / dtMs : 0;
    this.#lastY = y;
    const k = 1 - Math.exp(-dtMs / SCROLL_SMOOTH_MS);
    this.scrollSpeed += (instant - this.scrollSpeed) * k;
  }

  /**
   * Next tour scroll position, or NaN when the tour should not move this frame.
   * @param frontier Top of the seen part of the earliest unfinished layer (Infinity when none is left).
   * @param worldHeight Height of the world; the tour stops at the bottom.
   * @param lead How far below the top edge the frontier is kept, as a share of the viewport.
   */
  tour(
    vp: Rect,
    frontier: number,
    worldHeight: number,
    speed: number,
    dtMs: number,
    pt: number,
    lead = TOUR_LEAD_SHARE,
  ): number {
    if (Number.isNaN(this.#tourY)) this.#tourY = vp.y;
    // Programmatic scrolls may be clamped or rounded by the stage: follow what it reports.
    if (Math.abs(this.#tourY - vp.y) > 2) this.#tourY = vp.y;
    if (pt < this.#holdUntil || dtMs <= 0) {
      this.#tourV = 0;
      return Number.NaN;
    }
    const maxScroll = Math.max(0, worldHeight - vp.h);
    const target = clamp(frontier - vp.h * clamp(lead, 0, 1), 0, maxScroll);
    const cap = TOUR_MAX_PX_S * clamp(speed, 1, TOUR_SPEED_SCALE_MAX);
    const desired = clamp((target - this.#tourY) * TOUR_GAIN, 0, cap);
    this.#tourV += (desired - this.#tourV) * (1 - Math.exp(-dtMs / TOUR_SMOOTH_MS));
    if (this.#tourV < 0.5 && desired === 0) {
      this.#tourV = 0;
      return Number.NaN;
    }
    const next = Math.min(this.#tourY + (this.#tourV * dtMs) / 1000, Math.max(target, this.#tourY));
    this.#tourY = next;
    return next;
  }
}
