import type { OverlayHandle, Rect, Rng, StageApi } from "../types";
import type { Agent } from "./agent";
import { ICON_FADE_IN_MS, ICON_FADE_OUT_MS, ICON_SIZE, INTRO_MIN_MS, INTRO_SPAN_MS } from "./constants";
import { clamp } from "./easing";
import { steerTo } from "./steer";

/** Warp band width as a share of the viewport width, clamped to [MIN, MAX] px. */
const BAND_SHARE = 0.56;
const BAND_MIN_PX = 160;
const BAND_MAX_PX = 560;
/** Lanes spread over this height around the viewport centre, px. */
const BAND_HEIGHT_PX = 56;
/** One pass across the band takes MIN + share * SPAN ms (0.6 to 1.1 s). */
const PASS_MIN_MS = 600;
const PASS_SPAN_MS = 500;
const SHUTTLE_ACCEL = 3200;
const SHUTTLE_SLOW_RADIUS = 40;
/** Shuttles may chase their lane position faster than they wander. */
const SHUTTLE_SPEED_BOOST = 1.8;

interface IconProps extends Record<string, unknown> {
  x: number;
  y: number;
  size: number;
  alpha: number;
  src?: string;
}

/**
 * Intro, the "warp" opening: the blueprint icon fades in at the viewport centre while the crew
 * walks in and shuttles back and forth on a horizontal band behind it, each cursor on its own
 * lane and pace, like weft passes on a loom. After 1.5 to 2.5 s (seeded) the crew fans out to
 * work while the icon shrinks away.
 */
export class IntroShuttle {
  /** Intro length in player ms, drawn from the rng in {@link begin}. */
  duration = 0;
  #startedAt = 0;
  #fanoutAt = Number.POSITIVE_INFINITY;
  #icon: OverlayHandle | null = null;
  readonly #props: IconProps = { x: 0, y: 0, size: ICON_SIZE, alpha: 0 };

  begin(stage: StageApi, icon: string | undefined, vp: Rect, pt: number, rng: Rng): void {
    this.end();
    this.duration = INTRO_MIN_MS + rng() * INTRO_SPAN_MS;
    this.#startedAt = pt;
    this.#fanoutAt = Number.POSITIVE_INFINITY;
    const props = this.#props;
    props.x = vp.x + vp.w / 2;
    props.y = vp.y + vp.h / 2;
    props.size = ICON_SIZE;
    props.alpha = 0;
    props.src = icon || undefined;
    this.#icon = stage.overlay("icon", props);
  }

  /** Player time at which the intro should end. */
  get endsAt(): number {
    return this.#startedAt + this.duration;
  }

  fanOut(pt: number): void {
    this.#fanoutAt = pt;
  }

  /** Per-frame icon animation; removes the icon once it has faded out. */
  frame(vp: Rect, pt: number): void {
    const icon = this.#icon;
    if (!icon) return;
    const props = this.#props;
    props.x = vp.x + vp.w / 2;
    props.y = vp.y + vp.h / 2;
    if (pt < this.#fanoutAt) {
      props.alpha = clamp((pt - this.#startedAt) / ICON_FADE_IN_MS, 0, 1);
    } else {
      const out = clamp((pt - this.#fanoutAt) / ICON_FADE_OUT_MS, 0, 1);
      props.alpha = 1 - out;
      props.size = ICON_SIZE * (1 - 0.5 * out);
      if (out >= 1) {
        this.end();
        return;
      }
    }
    icon.update(props);
  }

  /**
   * Steers one shuttling agent for a physics step of `h` seconds. Its lane, pace and phase come
   * from its seeded movement personality; the pass eases at both ends of the band.
   */
  steer(agent: Agent, vp: Rect, pt: number, h: number): void {
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    const half = clamp(vp.w * BAND_SHARE, BAND_MIN_PX, BAND_MAX_PX) / 2;
    // orbitRadius is 0.75..1.25 and orbitSpeed 0.8..1.5: map them to a lane and a pass length.
    const lane = clamp((agent.orbitRadius - 1) * 2, -1, 1) * (BAND_HEIGHT_PX / 2);
    const pass = PASS_MIN_MS + clamp((agent.orbitSpeed - 0.8) / 0.7, 0, 1) * PASS_SPAN_MS;
    const phase = agent.orbitPhase + (agent.swirl * Math.PI * pt) / pass;
    steerTo(
      agent,
      cx - half * Math.cos(phase),
      cy + lane,
      agent.maxSpeed * SHUTTLE_SPEED_BOOST,
      SHUTTLE_ACCEL,
      SHUTTLE_SLOW_RADIUS,
      h,
    );
  }

  /** Removes the icon overlay (fan-out finished, replay, go live, destroy). */
  end(): void {
    this.#icon?.remove();
    this.#icon = null;
  }
}
