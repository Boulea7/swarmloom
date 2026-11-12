/** Pose of infinite animations in a live capture, as a fraction of one cycle (decision C02). */
export const LOOP_PHASE = 0.5;

/**
 * Runs in the captured page: puts every CSS animation, transition and Web Animation into a pose that
 * does not depend on when the capture ran, the rule of `freezeAnimations` in @swarmloom/adapter-html
 * (decision C02). Finite ones jump to their end state; infinite loops pause `phase` of a cycle after
 * their delay. Without it an endless pulse was read at a different pose in every run, so two renders
 * of the same URL built different pages.
 *
 * Self-contained: Playwright sends its source to the page. Animations a later scroll starts still run.
 * @returns How many animations were frozen.
 */
export function freezePageAnimations(phase: number): number {
  const all = typeof document.getAnimations === "function" ? document.getAnimations() : [];
  let frozen = 0;
  for (const anim of all) {
    const timing = anim.effect?.getComputedTiming();
    if (!timing) continue;
    try {
      if (Number.isFinite(timing.endTime)) {
        anim.finish();
      } else {
        const cycle = typeof timing.duration === "number" && Number.isFinite(timing.duration) ? timing.duration : 0;
        anim.pause();
        anim.currentTime = (timing.delay ?? 0) + phase * cycle;
      }
      frozen++;
    } catch {
      // finish() throws for zero playback rates; such animations already sit still.
    }
  }
  return frozen;
}
