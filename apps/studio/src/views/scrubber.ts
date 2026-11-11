import type { PlayerState } from "@swarmloom/core";
import type { StudioI18n } from "../i18n";
import type { SessionPhase } from "../session";
import { h } from "../ui/dom";

const STEPS = 1000;
/** Keys on the slider: arrows move 2 %, Page Up/Down 10 %, Home/End jump to the ends. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 20,
  ArrowUp: 20,
  ArrowLeft: -20,
  ArrowDown: -20,
  PageUp: 100,
  PageDown: -100,
  Home: -STEPS,
  End: STEPS,
};
/** Phases in which the slider acts on a running player (before play, the play button starts it). */
const ACTIVE: ReadonlySet<SessionPhase> = new Set(["playing", "done"]);
/** Player states in which player time advances, so the slider moves on its own. */
const RUNNING: ReadonlySet<PlayerState> = new Set(["intro", "building"]);

export interface ScrubberOptions {
  i18n: StudioI18n;
  /** Seeks to a fraction of the build (`Session.seek`); false when the player cannot. */
  seek(fraction: number): boolean;
  /** Current position between 0 and 1 on the same scale (`Session.position`). */
  position(): number;
}

/** The player footer's progress: a seek slider for seekable players, a progress bar otherwise. */
export interface Scrubber {
  /** The bar and the slider (one of them hidden). */
  readonly root: HTMLElement;
  /** "built / total" layer count. */
  readonly count: HTMLElement;
  /** A new player is ready: shows the slider when it can seek, the plain bar otherwise. */
  ready(canSeek: boolean): void;
  setPhase(phase: SessionPhase): void;
  setProgress(built: number, total: number): void;
  setState(state: PlayerState): void;
  /** The interface language changed: relabels the bar and the slider. */
  relabel(i18n: StudioI18n): void;
  destroy(): void;
}

/**
 * Creates the scrubber (decisions-v1 S05). The slider shows the player's position on the time
 * line `seek` uses, like a video position, and is redrawn on animation frames only while player
 * time advances. A seek back re-simulates the build from the start synchronously, so a pointer
 * drag only previews its value and seeks once, when it is let go (like the core toolbar's seek
 * bar); keys seek at most once per frame, to the latest value. The layer count and the plain bar
 * (for players without `seek`) follow progress events, rendered on the next frame.
 */
export function createScrubber(options: ScrubberOptions): Scrubber {
  const { i18n } = options;
  let percent = new Intl.NumberFormat(i18n.locale, { style: "percent" });
  let built = 0;
  let total = 0;
  let state: PlayerState = "idle";
  let frame = 0;
  let seekPending = false;
  /** The slider was dragged and not let go yet: it shows the dragged value, the seek waits. */
  let held = false;
  let destroyed = false;

  const fill = h("span", { class: "progress-fill" });
  const bar = h(
    "div",
    {
      class: "progress",
      attrs: {
        role: "progressbar",
        "aria-label": i18n.t("player.progress"),
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": 0,
      },
    },
    fill,
  );
  const slider = h("input", {
    class: "scrub-range",
    attrs: {
      type: "range",
      min: 0,
      max: STEPS,
      step: 1,
      value: 0,
      "aria-label": i18n.t("player.scrub"),
      hidden: true,
      disabled: true,
    },
    on: {
      input: () => {
        held = true;
        paintSlider();
      },
      change: () => requestSeek(),
      keydown: (event) => {
        const delta = KEY_STEPS[event.key];
        if (delta === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        slider.value = String(Math.max(0, Math.min(STEPS, Number(slider.value) + delta)));
        requestSeek();
      },
    },
  });
  const count = h("span", { class: "scrub-count", attrs: { "aria-hidden": "true" } });
  const root = h("div", { class: "scrubber" }, bar, slider);

  /** Track fill and spoken value follow the slider value, also while it is dragged. */
  const paintSlider = () => {
    const value = Number(slider.value) / STEPS;
    slider.style.setProperty("--scrub", `${(value * 100).toFixed(1)}%`);
    slider.setAttribute("aria-valuetext", percent.format(value));
  };

  const render = () => {
    const text = total > 0 ? `${built} / ${total}` : "";
    if (count.textContent !== text) count.textContent = text;
    if (!bar.hidden) {
      const layers = total > 0 ? Math.min(1, built / total) : 0;
      fill.style.transform = `scaleX(${layers})`;
      bar.setAttribute("aria-valuenow", String(Math.round(layers * 100)));
    }
    // A held thumb stays where the user put it until it is let go.
    if (slider.hidden || seekPending || held || slider.matches(":active")) return;
    const step = String(Math.round(options.position() * STEPS));
    if (slider.value !== step) {
      slider.value = step;
      paintSlider();
    }
  };

  const loop = () => {
    frame = 0;
    if (seekPending) {
      seekPending = false;
      options.seek(Number(slider.value) / STEPS);
    }
    render();
    // Keep redrawing while player time advances; otherwise the next event wakes the loop.
    if (RUNNING.has(state)) wake();
  };
  const wake = () => {
    if (!frame && !destroyed) frame = requestAnimationFrame(loop);
  };
  const requestSeek = () => {
    held = false;
    if (slider.disabled) return;
    paintSlider();
    seekPending = true;
    wake();
  };
  /**
   * Ends a drag wherever the pointer is let go, also when no `change` follows (the thumb went back
   * to where it started): release seeks to the dragged value, a cancelled pointer drops it.
   */
  const release = (event: PointerEvent) => {
    if (!held) return;
    if (event.type === "pointerup") return requestSeek();
    held = false;
    wake();
  };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);

  render();
  return {
    root,
    count,
    ready(canSeek) {
      seekPending = false;
      held = false;
      slider.hidden = !canSeek;
      bar.hidden = canSeek;
      slider.value = "0";
      paintSlider();
      wake();
    },
    setPhase(phase) {
      slider.disabled = !ACTIVE.has(phase);
    },
    setProgress(b, t) {
      built = b;
      total = t;
      wake();
    },
    setState(next) {
      state = next;
      wake();
    },
    relabel(next) {
      percent = new Intl.NumberFormat(next.locale, { style: "percent" });
      bar.setAttribute("aria-label", next.t("player.progress"));
      slider.setAttribute("aria-label", next.t("player.scrub"));
      paintSlider();
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
