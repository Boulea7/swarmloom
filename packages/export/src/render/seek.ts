/** The part of a Web Animation (CSS animation, transition or script animation) the seek uses. */
export interface SeekableAnimation {
  readonly playState: AnimationPlayState;
  readonly playbackRate: number;
  currentTime: CSSNumberish | null;
  /** Read only for an animation that starts reversed: it starts at its effect's end. */
  readonly effect?: { getComputedTiming(): ComputedEffectTiming } | null;
  pause(): void;
}

/** The part of an outermost `<svg>` element the seek uses: its SMIL time container. */
export interface SeekableSvg {
  pauseAnimations(): void;
  setCurrentTime(seconds: number): void;
}

interface Anchor {
  /** Animation time when first seen: ms for Web Animations, s for SVG. */
  readonly base: number;
  /** Transport time when first seen, ms. */
  readonly t0: number;
}

/**
 * Where an animation first seen after the first seek starts: at 0, or at its effect's end when it
 * plays backwards (null when that end is infinite).
 */
function startOf(anim: SeekableAnimation, rate: number): number | null {
  if (rate >= 0) return 0;
  const end = anim.effect?.getComputedTiming().endTime;
  return typeof end === "number" && Number.isFinite(end) ? end : null;
}

/**
 * Drives animations from transport (video) time instead of wall time, so every frame is a pure
 * function of it. Each animation is anchored the first time it is seen, at a pose and the transport
 * time then; every seek pauses it and sets `currentTime = base + (t - t0) * playbackRate`, so it
 * plays on from that pose at its own speed, but only as far as the export clock moved. The first
 * seek (go live) anchors the animations it finds at their pose then, the frozen pose of the page.
 * An animation first seen later is one that started since (a seeked value changed an inherited
 * value or a container's size, and a transition or a container query's animation began): it is
 * anchored at its start, since its time then counts the wall time since that style change. SVG
 * documents are anchored at 0 s.
 */
export class AnimationSeeker {
  readonly #anchors = new WeakMap<object, Anchor>();
  /** True once {@link seekAnimations} ran: animations first seen from then on are anchored at their start. */
  #started = false;

  #anchor(target: object, base: number, t: number): Anchor {
    let anchor = this.#anchors.get(target);
    if (!anchor) {
      anchor = { base, t0: t };
      this.#anchors.set(target, anchor);
    }
    return anchor;
  }

  /**
   * Pauses each animation and sets its time for transport time `t` (ms). Idle animations and ones
   * on non-time timelines (scroll-driven, whose time is a percentage) are left alone.
   *
   * Reads every animation before it writes any: Chromium's CSS animation and transition getters
   * flush style, and each `pause()` or `currentTime` write dirties it again, so reading and writing
   * them in turn recalculates the document's style once per animation (seconds per frame on a page
   * with thousands of them).
   * @returns How many animations were seeked.
   */
  seekAnimations(animations: Iterable<SeekableAnimation>, t: number): number {
    const count = this.#seek(animations, t, false);
    this.#started = true;
    return count;
  }

  /**
   * Seeks, as {@link seekAnimations} does, only the animations no seek has seen yet: the ones a
   * seek's writes started, once the caller made the style and layout update that creates them.
   * Anchored at their start, they play from `t` on.
   * @returns How many animations were seeked.
   */
  seekNew(animations: Iterable<SeekableAnimation>, t: number): number {
    return this.#seek(animations, t, true);
  }

  #seek(animations: Iterable<SeekableAnimation>, t: number, onlyNew: boolean): number {
    const seeks: { anim: SeekableAnimation; paused: boolean; time: number }[] = [];
    for (const anim of animations) {
      // Checked before any getter, so passing the animations seen before costs no style flush.
      if (onlyNew && this.#anchors.has(anim)) continue;
      const state = anim.playState;
      if (state === "idle") continue;
      const current = anim.currentTime;
      if (current !== null && typeof current !== "number") continue;
      const rate = anim.playbackRate;
      let anchor = this.#anchors.get(anim);
      if (!anchor) {
        anchor = { base: (this.#started ? startOf(anim, rate) : null) ?? current ?? 0, t0: t };
        this.#anchors.set(anim, anchor);
      }
      seeks.push({ anim, paused: state === "paused", time: anchor.base + (t - anchor.t0) * rate });
    }
    let count = 0;
    for (const { anim, paused, time } of seeks) {
      try {
        if (!paused) anim.pause();
        anim.currentTime = time;
        count++;
      } catch {
        // pause() refuses some reversed infinite animations; they keep their state.
      }
    }
    return count;
  }

  /**
   * Pauses each SVG document's animations and sets its time to `(t - t0) / 1000` s, where `t0` is
   * the transport time it was first seen at.
   * @returns How many SVG documents were seeked.
   */
  seekSvgs(svgs: Iterable<SeekableSvg>, t: number): number {
    let count = 0;
    for (const svg of svgs) {
      const { base, t0 } = this.#anchor(svg, 0, t);
      try {
        svg.pauseAnimations();
        svg.setCurrentTime(base + (t - t0) / 1000);
        count++;
      } catch {
        // Detached documents have no time container.
      }
    }
    return count;
  }
}
