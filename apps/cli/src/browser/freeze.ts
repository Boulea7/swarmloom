/** Pose of infinite animations in a live capture, as a fraction of one cycle (decision C02). */
export const LOOP_PHASE = 0.5;

/**
 * Runs in the captured page: puts every CSS animation, transition and Web Animation into a pose that
 * does not depend on when the capture ran, the rule of `freezeAnimations` in @swarmloom/adapter-html
 * (decision C02). Finite ones jump to their end state; infinite loops pause `phase` of a cycle after
 * their delay. Without it an endless pulse was read at a different pose in every run, so two renders
 * of the same URL built different pages.
 *
 * Self-contained: Playwright sends its source to the page. Open shadow roots are frozen too; closed
 * roots and child frames are out of reach. Animations a later scroll starts still run, so the CLI calls
 * it after the pre-scroll pass that starts reveal-on-scroll transitions.
 * @returns How many animations were frozen.
 */
export function freezePageAnimations(phase: number): number {
  const all = new Set<Animation>();
  const roots: (Document | ShadowRoot)[] = [document];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i] as Document | ShadowRoot;
    if (typeof root.getAnimations === "function") for (const anim of root.getAnimations()) all.add(anim);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
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

/** Options of {@link freezePageVideos}. */
export interface VideoFreeze {
  /** Pose of looping videos, as a fraction of their duration (see {@link LOOP_PHASE}). */
  phase: number;
  /** Longest wait for the metadata and the seeks of all videos together. */
  timeoutMs: number;
}

/**
 * Runs in the captured page: pauses every video that plays or is set to autoplay and seeks it to the
 * pose of {@link freezePageAnimations}: a loop `phase` of its duration in, a single run at its end.
 * Then waits until the frame is decoded and painted, so the screenshot and the snapshot show the same
 * picture in every run. Without it an autoplay hero video was read at whatever frame real time had
 * reached, so two renders of the same URL built different pages.
 *
 * Videos in open shadow roots count; videos in frames do not. A server without range requests lets
 * the browser seek only to the start, so its videos stop on their first frame. Live streams (no finite
 * duration) are only paused.
 *
 * Self-contained: Playwright sends its source to the page.
 * @returns How many videos were frozen.
 */
export async function freezePageVideos({ phase, timeoutMs }: VideoFreeze): Promise<number> {
  const videos: HTMLVideoElement[] = [];
  const collect = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll("*")) {
      if (el instanceof HTMLVideoElement && (!el.paused || el.autoplay)) videos.push(el);
      if (el.shadowRoot) collect(el.shadowRoot);
    }
  };
  collect(document);
  if (videos.length === 0) return 0;
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  const event = (video: HTMLVideoElement, names: string[]) =>
    Promise.race([
      deadline,
      new Promise<void>((resolve) => {
        for (const name of names) video.addEventListener(name, () => resolve(), { once: true });
      }),
    ]);
  await Promise.all(
    videos.map(async (video) => {
      // Also cancels a pending autoplay, so the video cannot start after the capture began.
      video.pause();
      const failed = video.error !== null || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
      if (video.readyState < HTMLMediaElement.HAVE_METADATA && !failed) {
        await event(video, ["loadedmetadata", "error"]);
      }
      const { duration } = video;
      if (!Number.isFinite(duration) || duration <= 0) return;
      video.currentTime = video.loop ? phase * duration : duration;
      if (video.seeking) await event(video, ["seeked", "error"]);
    }),
  );
  // Two painted frames, so the compositor shows the new video frames before the screenshot.
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
      setTimeout(resolve, 200);
    });
  }
  return videos.length;
}
