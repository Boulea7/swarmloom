import type { CustomLayer, LayerRenderer, Plugin, TaskFn } from "@swarmloom/core";
import type { AnimationItem } from "lottie-web";
import { LOTTIE_PLUGIN, PLAYER_TASK } from "../constants";
import { type LottieRuntime, loadRuntime } from "../render/runtime";
import { type AnimTarget, registerAnimTarget } from "../timeline/target";
import { type PlayerSpec, readPlayer } from "./data";
import { cycleMs, indexAt, indexAtTime, timeOfIndex } from "./timing";

/** Options of {@link createLottiePlugin}. */
export interface LottiePluginOptions {
  /** Loads lottie-web. Default: the light SVG player, imported on first use. Tests pass a fake. */
  runtime?: () => Promise<LottieRuntime>;
}

/** A mounted lottie-web animation. */
interface View {
  readonly host: HTMLElement;
  item: AnimationItem | null;
  /** Frame index last handed to lottie-web (-1: none). */
  applied: number;
  visible: boolean;
  readonly ready: Promise<void>;
  dispose(): void;
}

/** Playback state of one player layer; it outlives mounts (the stage virtualises layers). */
interface PlayerState {
  readonly spec: PlayerSpec;
  /** static: the woven pose shows; seek: a scrubbed frame shows; play: engine-timed playback. */
  mode: "static" | "seek" | "play";
  /** Frame index shown (from the in point). */
  index: number;
  /** Engine time playback started at; set by the first frame() after play(). */
  startAt: number | null;
  /** Cycle time playback started from, ms. */
  from: number;
  view: View | null;
  readonly target: AnimTarget;
}

/**
 * Plays a `lottie:player` layer while the stage builds it: its task completes at once and draws
 * nothing, so the woven layers stay visible. The `anim:timeline` choreography then drives the
 * layer through its {@link AnimTarget}: `seek()` shows scrubbed frames over the woven pose,
 * `play()` starts playback.
 *
 * Playback is timed only by engine time (`Plugin.frame(now)`), in whole source frames, applied
 * with `goToAndStop(frame, true)`; lottie-web never runs its own clock. Frame updates are applied
 * once per engine tick (coalesced in a microtask), so fast-forward seeks stay cheap. When the
 * engine clock goes back (replay, seek), every player returns to the woven pose.
 *
 * One plugin instance serves one player at a time.
 */
export function createLottiePlugin(options: LottiePluginOptions = {}): Plugin {
  const load = options.runtime ?? loadRuntime;
  const states = new Map<CustomLayer, PlayerState>();
  let lastNow = Number.NEGATIVE_INFINITY;
  let queued = false;
  let warned = false;

  const apply = (s: PlayerState): void => {
    const view = s.view;
    if (!view) return;
    const show = s.mode !== "static" && view.item !== null;
    if (show !== view.visible) {
      view.visible = show;
      view.host.style.visibility = show ? "" : "hidden";
    }
    if (view.item && view.applied !== s.index) {
      view.applied = s.index;
      view.item.goToAndStop(s.index, true);
    }
  };

  const flush = (): void => {
    queued = false;
    for (const s of states.values()) apply(s);
  };

  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  };

  const toStatic = (s: PlayerState): void => {
    s.mode = "static";
    s.startAt = null;
    s.index = s.spec.rest;
  };

  const createState = (spec: PlayerSpec): PlayerState => {
    const duration = cycleMs(spec.timing);
    const s: PlayerState = {
      spec,
      mode: "static",
      index: spec.rest,
      startAt: null,
      from: 0,
      view: null,
      target: {
        duration,
        ready: () => s.view?.ready ?? Promise.resolve(),
        seek(t) {
          s.mode = "seek";
          s.startAt = null;
          s.index = indexAtTime(t, spec.timing);
          schedule();
        },
        play(t = 0) {
          s.mode = "play";
          s.startAt = null;
          s.from = Math.min(duration, Math.max(0, Number.isFinite(t) ? t : 0));
          s.index = indexAtTime(s.from, spec.timing);
          schedule();
        },
        reset() {
          toStatic(s);
          schedule();
        },
        time: () => (s.mode === "static" ? null : timeOfIndex(s.index, spec.timing)),
      },
    };
    return s;
  };

  const stateOf = (layer: CustomLayer): PlayerState | null => {
    let s = states.get(layer);
    if (!s) {
      const spec = readPlayer(layer);
      if (!spec) return null;
      s = createState(spec);
      states.set(layer, s);
    }
    return s;
  };

  /** A player that cannot start leaves the woven pose in place; one warning per plugin is enough. */
  const warn = (error: unknown): void => {
    if (!warned) console.warn("SwarmLoom lottie: the player could not start", error);
    warned = true;
  };

  const mountView = (s: PlayerState, container: HTMLElement): View => {
    const doc = container.ownerDocument;
    const host = doc.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;visibility:hidden";
    host.style.background = s.spec.background;
    let disposed = false;
    const unregister = registerAnimTarget(host, s.target);
    const view: View = {
      host,
      item: null,
      applied: -1,
      visible: false,
      ready: load().then((runtime) => {
        if (disposed) return;
        try {
          view.item = runtime.loadAnimation({
            container: host,
            renderer: "svg",
            loop: false,
            autoplay: false,
            // lottie-web mutates the data it is given: every mount parses its own copy.
            animationData: JSON.parse(s.spec.json),
            rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: false, hideOnTransparent: true },
          });
        } catch (error) {
          warn(error);
          return;
        }
        apply(s);
      }, warn),
      dispose() {
        disposed = true;
        unregister();
        view.item?.destroy();
        view.item = null;
      },
    };
    return view;
  };

  const renderer: LayerRenderer<CustomLayer> = {
    mount(layer, container) {
      const s = stateOf(layer);
      if (!s) return;
      s.view?.dispose();
      s.view = mountView(s, container);
      return s.view.host;
    },
    reveal(layer, p) {
      // Revealed back to 0 only when the stage restarts the build.
      const s = states.get(layer);
      if (s && p <= 0 && s.mode !== "static") {
        toStatic(s);
        schedule();
      }
    },
    unmount(layer) {
      const s = states.get(layer);
      s?.view?.dispose();
      if (s) s.view = null;
    },
  };

  // biome-ignore lint/correctness/useYield: no cursor work; the generator keeps finish() lazy until the engine runs it.
  const task: TaskFn<CustomLayer> = function* (_agent, layer, stage) {
    stage.finish(layer.id);
  };

  return {
    name: LOTTIE_PLUGIN,
    tasks: { [PLAYER_TASK]: task },
    renderers: { [PLAYER_TASK]: renderer },
    setup() {
      // A new player on the same loaded source (Studio re-creates players): start from the woven pose.
      lastNow = Number.NEGATIVE_INFINITY;
      for (const s of states.values()) toStatic(s);
    },
    frame(now) {
      if (now < lastNow - 1e-6) {
        // The engine restarted its clock (replay or seek): back to the woven pose.
        for (const s of states.values()) toStatic(s);
        schedule();
      }
      lastNow = now;
      let dirty = false;
      for (const s of states.values()) {
        if (s.mode !== "play") continue;
        s.startAt ??= now;
        const index = indexAt(now - s.startAt, s.spec.timing, s.from);
        if (index !== s.index) {
          s.index = index;
          dirty = true;
        }
      }
      if (dirty) schedule();
    },
  };
}
