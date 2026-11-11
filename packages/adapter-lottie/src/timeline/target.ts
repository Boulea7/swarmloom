/**
 * Something the `anim:timeline` choreography can scrub and then start: a Lottie player, a live
 * SVG with SMIL animations, an element with CSS animations. Its plugin registers it on the DOM
 * element of its layer ({@link registerAnimTarget}); the timeline finds it through
 * `StageApi.el(data.target)`.
 *
 * Playback must be timed by the engine clock (`Plugin.frame`), never by the target's own
 * `requestAnimationFrame`, so exports stay frame-exact. The one exception is a realtime player
 * after go live: it stops its clock, and a target that plays on (as the page's own CSS and SMIL
 * animations do) runs on wall time; it then reports its moves through `subscribe`.
 */
export interface AnimTarget {
  /** Length of one cycle, ms (> 0). */
  readonly duration: number;
  /** Optional: resolves when the target can show poses (runtime loaded, assets decoded). */
  ready?(): Promise<void>;
  /** Shows the pose at `t` ms (clamped to one cycle) and stops playback. */
  seek(t: number): void;
  /** Starts playback at `t` ms of the cycle (default 0), timed from the next engine frame. */
  play(t?: number): void;
  /** Back to the static pose of the weave: playback stopped, nothing drawn over the woven layers. */
  reset(): void;
  /** Time shown within the cycle, ms, or null while the static pose is shown. */
  time(): number | null;
  /**
   * Optional: calls `listener` whenever the time shown changes, including moves without engine
   * frames (after go live). Returns the function that stops the calls.
   */
  subscribe?(listener: () => void): () => void;
}

const targets = new WeakMap<Element, AnimTarget>();

/**
 * Registers the animation target of a mounted layer element.
 *
 * @returns A function that removes the registration (call it from `LayerRenderer.unmount`).
 */
export function registerAnimTarget(el: Element, target: AnimTarget): () => void {
  targets.set(el, target);
  return () => {
    if (targets.get(el) === target) targets.delete(el);
  };
}

/** The animation target registered on `el` (the element `StageApi.el()` returns for its layer). */
export function animTargetOf(el: Element | null | undefined): AnimTarget | undefined {
  return el ? targets.get(el) : undefined;
}
