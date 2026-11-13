/** Pose of infinite animations in a live capture, as a fraction of one cycle (decision C02). */
export const LOOP_PHASE = 0.5;

/** Global that {@link catchEndEvents} installs in the captured page. */
export const END_EVENTS_GLOBAL = "__swarmloomEndEvents";

/** Options of {@link freezePageAnimations}. */
export interface AnimationFreeze {
  /** Pose of infinite animations, as a fraction of one cycle (see {@link LOOP_PHASE}). */
  phase: number;
  /** Global that {@link catchEndEvents} installed in the page, if it ran there. */
  endEvents: string;
}

/**
 * Runs in the captured page before its own scripts (a Playwright init script): listens for
 * `animationend` and `transitionend` at the window in the capture phase, so ahead of every listener
 * the page adds there, and hands them to the filters that {@link freezePageAnimations} registers
 * through the global `name`. Without it a page listening at the window in the capture phase saw the
 * end events the freeze must keep from it, and restarted the animation on wall time.
 *
 * Self-contained: Playwright sends its source to the page.
 */
export function catchEndEvents(name: string): void {
  const filters: ((event: Event) => void)[] = [];
  const pass = (event: Event) => {
    for (const filter of filters) filter(event);
  };
  addEventListener("animationend", pass, true);
  addEventListener("transitionend", pass, true);
  Object.defineProperty(globalThis, name, { value: (filter: (event: Event) => void) => void filters.push(filter) });
}

/**
 * Runs in the captured page: puts every CSS animation, transition and Web Animation into a pose that
 * does not depend on when the capture ran, the rule of `freezeAnimations` in @swarmloom/adapter-html
 * (decision C02). Finite ones jump to their end state; infinite loops pause `phase` of a cycle after
 * their delay. Without it an endless pulse was read at a different pose in every run, so two renders
 * of the same URL built different pages.
 *
 * Finishing an animation fires `animationend` or `transitionend` with the next frame, and pages often
 * start a new loop there (a spinner after an entrance, a blinking caret after a typewriter). So after
 * each pass it waits two frames and freezes the animations that appeared, until a pass finds none or
 * after a few passes for a page that keeps starting new ones.
 *
 * A page can also restart a finite animation from its end handler: play the same object again, or
 * toggle a class (or `style.animation`) back, which makes a new CSS animation object every time.
 * Finishing it again would only start it again, and the last restart would run on wall time. So when
 * one of these comes back in a later pass, and for every finite animation of the last pass, it is
 * paused at its end instead, and the end event that this seek still fires is kept from the page: by
 * the window listener of {@link catchEndEvents}, which runs before all of the page's, or, when that
 * init script did not run, by a capture listener added at the window now, which a capture listener
 * the page put on the window earlier still precedes. In an open shadow root, whose end events do not
 * reach the window, the freeze listens at the root, after a capture listener the page put there.
 *
 * Self-contained: Playwright sends its source to the page. Open shadow roots are frozen too; closed
 * roots and child frames are out of reach. Animations a later scroll or a later event starts still
 * run, so the CLI calls it after the pre-scroll pass that starts reveal-on-scroll transitions and again
 * after {@link freezePageVideos}, whose pauses fire `pause` events.
 * @returns How many animations were frozen.
 */
export async function freezePageAnimations({ phase, endEvents }: AnimationFreeze): Promise<number> {
  const collect = () => {
    const all = new Set<Animation>();
    const roots: (Document | ShadowRoot)[] = [document];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i] as Document | ShadowRoot;
      if (typeof root.getAnimations === "function") for (const anim of root.getAnimations()) all.add(anim);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return all;
  };
  const frame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
      setTimeout(resolve, 200);
    });
  // Same key for the new objects a restart creates: a CSS animation's name, a transition's property,
  // a Web Animation's keyframes; with the pseudo-element. Their end events carry the same key.
  const keyOf = (anim: Animation, effect: KeyframeEffect | null) => {
    const css = anim as Partial<CSSAnimation & CSSTransition>;
    const name =
      css.animationName !== undefined
        ? `a:${css.animationName}`
        : css.transitionProperty !== undefined
          ? `t:${css.transitionProperty}`
          : `w:${JSON.stringify(effect?.getKeyframes() ?? null)}`;
    return `${effect?.pseudoElement ?? ""} ${name}`;
  };
  const held = new WeakMap<Element, Set<string>>();
  const swallow = (event: Event) => {
    const e = event as AnimationEvent & TransitionEvent;
    const name = event.type === "animationend" ? `a:${e.animationName}` : `t:${e.propertyName}`;
    if (held.get(event.target as Element)?.has(`${e.pseudoElement ?? ""} ${name}`)) event.stopImmediatePropagation();
  };
  // Caught on the way down at the window, or at the shadow root since end events do not leave it,
  // so listeners on the element and its ancestors never see it.
  const hooked = new Set<EventTarget>();
  const hold = (target: Element, key: string) => {
    held.set(target, (held.get(target) ?? new Set()).add(key));
    const root = target.getRootNode();
    const at = root instanceof ShadowRoot ? root : window;
    if (hooked.has(at)) return;
    hooked.add(at);
    const early = at === window ? (globalThis as unknown as Record<string, unknown>)[endEvents] : undefined;
    if (typeof early === "function") {
      early(swallow);
      return;
    }
    at.addEventListener("animationend", swallow, true);
    at.addEventListener("transitionend", swallow, true);
  };
  const PASSES = 5;
  const seen = new Set<Animation>();
  // Pass in which each key was finished, per element (the document for target-less animations).
  const finished = new WeakMap<object, Map<string, number>>();
  let frozen = 0;
  for (let pass = 0; pass < PASSES; pass++) {
    const all = [...collect()];
    const fresh = all.filter((anim) => !seen.has(anim));
    // A finish handler can play the same Web Animation again.
    const restarted = all.filter((anim) => seen.has(anim) && anim.playState === "running");
    if (fresh.length === 0 && restarted.length === 0) break;
    for (const anim of [...fresh, ...restarted]) {
      const again = seen.has(anim);
      seen.add(anim);
      const timing = anim.effect?.getComputedTiming();
      if (!timing) continue;
      try {
        if (Number.isFinite(timing.endTime)) {
          const effect = anim.effect instanceof KeyframeEffect ? anim.effect : null;
          const owner = effect?.target ?? document;
          const key = keyOf(anim, effect);
          const ended = finished.get(owner) ?? new Map<string, number>();
          if (again || pass === PASSES - 1 || (ended.get(key) ?? pass) < pass) {
            if (effect?.target) hold(effect.target, key);
            anim.pause();
            anim.currentTime = anim.playbackRate < 0 ? 0 : (timing.endTime ?? 0);
          } else {
            finished.set(owner, ended.set(key, pass));
            anim.finish();
          }
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
    // The events of this pass fire with the next frame; their handlers may start new animations.
    for (let i = 0; i < 2; i++) await frame();
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
