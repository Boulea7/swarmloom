/**
 * Live hero. The static hero is the page's real content and its LCP; once the page has loaded and
 * the main thread is idle, `@swarmloom/element` is imported and the hero copy is wrapped in a
 * `<swarm-loom>` (children mode), so the swarm rebuilds the headline, subline and buttons in place.
 *
 * Every failure path leaves the static hero untouched: a missing or stub element (no `play`), an
 * import error, a `swarm-error`, or a player that never appears. Reduced motion never autoplays; it
 * offers a quiet "watch it build" button instead.
 */

import { onReducedMotionChange, prefersReducedMotion, saveData } from "./env";

/** The parts of the `<swarm-loom>` contract the hero relies on (all feature-detected). */
export interface SwarmLoomLike extends HTMLElement {
  play?: () => void;
  replay?: () => void;
  pause?: () => void;
  /** Null until a source has loaded (real element only). */
  readonly player?: unknown;
}

/** What the hero needs from the element module. */
export interface ElementModule {
  define?: (registry?: CustomElementRegistry) => unknown;
  TAG_NAME?: string;
}

export interface HeroOptions {
  /** Loads the element module (a dynamic import in production, a fake in tests). */
  load: () => Promise<ElementModule>;
  /** Agents per viewport width. */
  agents?: (width: number) => number;
  /** Ms to wait for a player before giving up and restoring the static hero. */
  guardMs?: number;
}

/** Hero lifecycle, mirrored to `data-live` on the hero for styling. */
export type HeroLiveState = "static" | "pending" | "building" | "done";

const RUNNING = new Set(["intro", "building", "finale"]);

const defaultAgents = (width: number): number => (width >= 1024 ? 9 : width >= 640 ? 7 : 5);

/** True when the registered element is a real player rather than the API stub. */
function isPlayable(tag: string): boolean {
  const ctor = customElements.get(tag);
  return typeof ctor === "function" && typeof (ctor.prototype as SwarmLoomLike).play === "function";
}

/**
 * Wires the live hero. Returns a promise that settles once the capability check is done (tests
 * await it; the page does not).
 */
export async function initHero(options: HeroOptions): Promise<HeroLiveState> {
  const hero = document.querySelector<HTMLElement>("[data-hero]");
  const copy = hero?.querySelector<HTMLElement>("[data-hero-copy]");
  const button = hero?.querySelector<HTMLButtonElement>("[data-replay]");
  if (!hero || !copy || saveData() || typeof customElements === "undefined") return "static";

  let mod: ElementModule;
  try {
    mod = await options.load();
    mod.define?.();
  } catch {
    return "static";
  }
  const tag = mod.TAG_NAME ?? "swarm-loom";
  if (!isPlayable(tag)) return "static";

  let el: SwarmLoomLike | null = null;
  let guard = 0;
  const setState = (state: HeroLiveState): void => {
    hero.dataset.live = state;
  };

  const restore = (): void => {
    clearTimeout(guard);
    if (el) {
      el.replaceWith(copy);
      el = null;
    }
    setState("static");
    if (button) button.hidden = true;
  };

  const showButton = (reduced: boolean): void => {
    if (!button) return;
    const label = reduced ? button.dataset.labelReduced : button.dataset.labelReplay;
    const target = button.querySelector("[data-replay-label]");
    if (label && target) target.textContent = label;
    button.hidden = false;
  };

  const mount = (forceMotion: boolean): void => {
    const node = document.createElement(tag) as SwarmLoomLike;
    node.className = "hero-live";
    node.setAttribute("agents", String((options.agents ?? defaultAgents)(innerWidth)));
    node.setAttribute("seed", "7");
    node.setAttribute("labels", "names");
    node.setAttribute("theme", "auto");
    node.setAttribute("finale", "none");
    node.setAttribute("inview", "");
    node.setAttribute("autoplay", "");
    node.setAttribute("reduced-motion", forceMotion ? "false" : "auto");
    node.addEventListener("swarm-state", (event) => {
      const state = (event as CustomEvent<{ state?: string }>).detail?.state;
      if (state && RUNNING.has(state)) {
        clearTimeout(guard);
        setState("building");
      } else if (state === "live" || state === "done") {
        setState("done");
      }
    });
    node.addEventListener("swarm-done", () => {
      setState("done");
      showButton(false);
    });
    node.addEventListener("swarm-error", (event) => {
      // The static copy is the fallback, so the element's own error message is not needed.
      event.preventDefault();
      restore();
    });
    // Decorations are hidden first so the snapshot contains only the real copy.
    setState("pending");
    copy.replaceWith(node);
    node.append(copy);
    el = node;
    guard = window.setTimeout(() => {
      if (el && el.player === null) restore();
    }, options.guardMs ?? 12000);
  };

  button?.addEventListener("click", () => {
    if (el?.replay) {
      setState("building");
      el.replay();
    } else {
      mount(true);
    }
    button.hidden = true;
  });

  // Focus inside the hero means the visitor is already using it: do not pull it out from under them.
  const busy = copy.contains(document.activeElement);
  if (prefersReducedMotion() || busy) {
    showButton(true);
    return "static";
  }
  mount(false);
  // Turning reduced motion on mid-build hands the finished static copy straight back.
  onReducedMotionChange((reduced) => {
    if (reduced && hero.dataset.live !== "done") restore();
  });
  return "pending";
}
