import type { CustomLayer, LayerRenderer, Plugin, TaskFn } from "@swarmloom/core";
import type { AnimationItem } from "lottie-web";
import { LOTTIE_PLUGIN, PLAYER_TASK } from "../constants";
import { type LottieRuntime, loadRuntime } from "../render/runtime";
import { type AnimTarget, registerAnimTarget } from "../timeline/target";
import { type PlayerSpec, readPlayer } from "./data";
import { cycleMs, indexAt, indexAtTime, playsOn, timeOfIndex } from "./timing";

/** Options of {@link createLottiePlugin}. */
export interface LottiePluginOptions {
  /** Loads lottie-web. Default: the light SVG player, imported on first use. Tests pass a fake. */
  runtime?: () => Promise<LottieRuntime>;
  /**
   * Clock of playback once the stage goes live: "own" (default) plays on in wall time, since a
   * realtime player stops its clock after go live; "player" stays on player time, for exports whose
   * virtual clock keeps ticking after go live and must stay frame-exact.
   */
  liveClock?: "own" | "player";
}

/** Throws when `value` is not a {@link LottiePluginOptions.liveClock} value. */
export function checkLiveClock(value: unknown, name: string): void {
  if (value !== undefined && value !== "own" && value !== "player") {
    throw new TypeError(`${name} must be "own" or "player"`);
  }
}

/** Own clock of a live stage: player time at go live, continued by wall time. */
interface LiveClock {
  readonly win: Window;
  /** Player time when the stage went live. */
  readonly base: number;
  /** `performance.now()` when the stage went live. */
  readonly since: number;
}

/** The element whose `data-live` attribute marks a live stage world (its shadow host). */
function worldOf(el: Element): Element | null {
  if (!el.isConnected) return null;
  const root = el.getRootNode();
  return "host" in root ? ((root as ShadowRoot).host ?? null) : null;
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
  /** Called when the frame shown changes (the timeline's playhead follows it). */
  readonly listeners: Set<() => void>;
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
 * Once the stage goes live (`data-live` on the world host), a realtime player stops its clock, so
 * with `liveClock: "own"` playback goes on from the player time at go live in wall time, one step
 * per animation frame; exports pass "player" and stay on player time.
 *
 * State lives in the instance, and every player gets its own (`Plugin.perPlayer`), so several
 * players of one loaded source never reset or redraw each other.
 */
export function createLottiePlugin(options: LottiePluginOptions = {}): Plugin {
  checkLiveClock(options.liveClock, "LottiePluginOptions.liveClock");
  const load = options.runtime ?? loadRuntime;
  const ownClock = options.liveClock !== "player";
  const states = new Map<CustomLayer, PlayerState>();
  let lastNow = Number.NEGATIVE_INFINITY;
  let queued = false;
  let warned = false;
  /** Set while the stage is live and playback runs on the own clock. */
  let live: LiveClock | null = null;
  /** Watches the world's `data-live` switch while a view is mounted (own clock only). */
  let observer: MutationObserver | null = null;
  let raf = 0;

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

  /**
   * Moves every playing player to time `now`; returns true while a mounted one still moves.
   * Listeners hear of every frame change at once (the time is read from the state, not the view).
   */
  const advance = (now: number): boolean => {
    let dirty = false;
    let moving = false;
    for (const s of states.values()) {
      if (s.mode !== "play") continue;
      s.startAt ??= now;
      const index = indexAt(now - s.startAt, s.spec.timing, s.from);
      if (s.view && playsOn(now - s.startAt, s.spec.timing, s.from)) moving = true;
      if (index === s.index) continue;
      s.index = index;
      dirty = true;
      for (const listener of s.listeners) listener();
    }
    if (dirty) schedule();
    return moving;
  };

  const tick = (): void => {
    raf = 0;
    const clock = live;
    if (clock && advance(clock.base + clock.win.performance.now() - clock.since)) {
      raf = clock.win.requestAnimationFrame(tick);
    }
  };

  /** Ticks the own clock again (after a mount or a play while live). */
  const wake = (): void => {
    if (live && !raf) raf = live.win.requestAnimationFrame(tick);
  };

  const stopTicks = (): void => {
    if (raf) live?.win.cancelAnimationFrame(raf);
    raf = 0;
  };

  const setLive = (on: boolean, win: Window): void => {
    if (on === (live !== null)) return;
    stopTicks();
    live = on ? { win, base: Number.isFinite(lastNow) ? lastNow : 0, since: win.performance.now() } : null;
    wake();
  };

  /** Starts watching the live switch once a view sits in the stage world (mounts get a detached container). */
  const follow = (): void => {
    if (!ownClock || observer) return;
    for (const s of states.values()) {
      const host = s.view?.host;
      const world = host ? worldOf(host) : null;
      const win = host?.ownerDocument.defaultView;
      if (!world || !win) continue;
      const read = (): void => setLive(world.hasAttribute("data-live"), win);
      observer = new win.MutationObserver(read);
      observer.observe(world, { attributes: true, attributeFilter: ["data-live"] });
      read();
      return;
    }
  };

  /** Back on player time: the live switch is no longer watched (a new stage, or the engine restarted). */
  const leaveLive = (): void => {
    stopTicks();
    live = null;
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
          wake();
        },
        reset() {
          toStatic(s);
          schedule();
        },
        time: () => (s.mode === "static" ? null : timeOfIndex(s.index, spec.timing)),
        subscribe(listener) {
          s.listeners.add(listener);
          return () => s.listeners.delete(listener);
        },
      },
      listeners: new Set(),
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
        follow();
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
      // The stage reveals a view once it sits in the world (also when it remounts while live).
      follow();
      wake();
    },
    unmount(layer) {
      const s = states.get(layer);
      s?.view?.dispose();
      if (s) s.view = null;
      if ([...states.values()].some((other) => other.view)) return;
      // Nothing left to draw: stop ticking; a later mount watches the switch again.
      observer?.disconnect();
      observer = null;
      stopTicks();
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
    perPlayer: () => createLottiePlugin(options),
    setup() {
      // A host that hands this very instance to a new player: start from the woven pose.
      lastNow = Number.NEGATIVE_INFINITY;
      leaveLive();
      for (const s of states.values()) toStatic(s);
    },
    frame(now) {
      if (now < lastNow - 1e-6) {
        // The engine restarted its clock (replay or seek): back to the woven pose.
        leaveLive();
        for (const s of states.values()) toStatic(s);
        schedule();
      }
      lastNow = now;
      follow();
      // Live on the own clock: wall time moves playback, whatever player time still arrives.
      if (!live) advance(now);
    },
  };
}
