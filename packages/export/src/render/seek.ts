/** The part of a Web Animation (CSS animation, transition or script animation) the seek uses. */
export interface SeekableAnimation {
  readonly playState: AnimationPlayState;
  readonly playbackRate: number;
  currentTime: CSSNumberish | null;
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
 * Drives animations from transport (video) time instead of wall time, so every frame is a pure
 * function of it. Each animation is anchored the first time it is seen, at its pose then and the
 * transport time then; every seek pauses it and sets
 * `currentTime = base + (t - t0) * playbackRate`, so it plays on from that pose at its own speed,
 * but only as far as the export clock moved. SVG documents are anchored at 0 s.
 */
export class AnimationSeeker {
  readonly #anchors = new WeakMap<object, Anchor>();

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
   * @returns How many animations were seeked.
   */
  seekAnimations(animations: Iterable<SeekableAnimation>, t: number): number {
    let count = 0;
    for (const anim of animations) {
      if (anim.playState === "idle") continue;
      const current = anim.currentTime;
      if (current !== null && typeof current !== "number") continue;
      const { base, t0 } = this.#anchor(anim, current ?? 0, t);
      try {
        if (anim.playState !== "paused") anim.pause();
        anim.currentTime = base + (t - t0) * anim.playbackRate;
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
