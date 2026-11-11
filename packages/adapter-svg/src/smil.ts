import type { CustomLayer, LayerRenderer, StageApi, TaskFn } from "@swarmloom/core";
import { SMIL_ELEMENTS, sanitizeSvgTree } from "./sanitize";
import { SVG_NS } from "./units";

/**
 * SMIL replay (decision C04): the drawing is woven as a static skeleton first, then its own
 * animation plays from 0 s. The `svg:smil` custom layer holds the sanitised animated markup; its
 * renderer mounts it hidden and paused at 0 s, its task fades it in over the woven skeleton, and
 * then the animation runs.
 *
 * While the player runs, animation time follows player time (`Plugin.frame`), so exports under a
 * VirtualClock stay frame-exact; once the stage goes live (`data-live` on the world host, the same
 * switch that lets CSS animations run), the SVG runs on its own clock (`unpauseAnimations()`),
 * unless the playback was created with `liveClock: "player"` (see {@link SmilPlaybackOptions}).
 */

/** Custom layer task (and renderer key) of the live, animated copy of the drawing. */
export const SMIL_TASK = "svg:smil";

/** `CustomLayer.data` of the `svg:smil` layer. */
export interface SvgSmilData {
  /** Sanitised standalone `<svg>` markup with its SMIL elements, sized to the layer box. */
  markup: string;
}

/** Upper bound on the markup accepted by the renderer (characters). */
const MAX_MARKUP = 8 * 1024 * 1024;
/** Cross-fade from the woven skeleton to the live drawing, engine ms. */
const FADE_MS = 420;
const FADE_STEP_MS = 30;

/** True when `root` contains an animation element that will play (not just an `mpath`). */
export function hasSmil(root: Element): boolean {
  for (const el of Array.from(root.getElementsByTagNameNS(SVG_NS, "*"))) {
    if (SMIL_ELEMENTS.has(el.localName) && el.localName !== "mpath") return true;
  }
  return false;
}

/** Removes every SMIL element, leaving the authored (un-animated) drawing. */
export function stripSmil(root: Element): void {
  for (const el of Array.from(root.getElementsByTagNameNS(SVG_NS, "*"))) {
    if (SMIL_ELEMENTS.has(el.localName)) el.remove();
  }
}

/** Per-mount state of a live copy. */
interface Live {
  readonly svg: SVGSVGElement;
  readonly wrapper: HTMLElement;
  readonly observer: MutationObserver | null;
  /** The weave is done and the animation runs. */
  started: boolean;
  /** Player time at the first frame after the start; null until then. */
  t0: number | null;
  /** The world went live: the SVG runs on its own clock. */
  live: boolean;
}

function markupOf(layer: CustomLayer): string {
  const data = layer.data as Partial<SvgSmilData> | undefined;
  return typeof data?.markup === "string" && data.markup.length <= MAX_MARKUP ? data.markup : "";
}

/** Parses and re-sanitises the markup: a blueprint may come from storage or another origin. */
function buildSvg(layer: CustomLayer, doc: Document): SVGSVGElement | null {
  const markup = markupOf(layer);
  if (!markup) return null;
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS || parsed.getElementsByTagName("parsererror").length) {
    return null;
  }
  sanitizeSvgTree(root);
  const svg = doc.importNode(root, true) as unknown as SVGSVGElement;
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";
  return svg;
}

function pause(svg: SVGSVGElement): void {
  svg.pauseAnimations?.();
}

/** Seeks the paused timeline; engines without SMIL support have no setCurrentTime. */
function seek(svg: SVGSVGElement, seconds: number): void {
  try {
    svg.setCurrentTime?.(seconds);
  } catch {
    // Detached or not yet laid out: the next frame seeks again.
  }
}

/** The element whose `data-live` attribute marks a live stage world (the shadow host). */
function worldHost(container: HTMLElement): Element | null {
  const root = container.getRootNode();
  return root && "host" in root ? ((root as ShadowRoot).host ?? null) : null;
}

/** Lets a started animation follow the stage: own clock while live, player time otherwise. */
function applyLive(state: Live, live: boolean): void {
  state.live = live;
  if (!state.started) return;
  if (live) state.svg.unpauseAnimations?.();
  else pause(state.svg);
}

/** Starts the animation from 0 s (the weave is done). */
function start(state: Live): void {
  if (state.started) return;
  state.started = true;
  state.t0 = null;
  seek(state.svg, 0);
  if (state.live) state.svg.unpauseAnimations?.();
}

/** Options of {@link createSmilPlayback}. */
export interface SmilPlaybackOptions {
  /**
   * Clock of a started animation once the stage goes live: "own" (default) unpauses it, so it keeps
   * playing after the player stops its clock; "player" keeps it on player time, for exports whose
   * virtual clock keeps ticking after go live and must stay frame-exact.
   */
  liveClock?: "own" | "player";
}

/** Renderer, task and frame hook of the SMIL replay; one instance per plugin (player). */
export interface SmilPlayback {
  renderer: LayerRenderer<CustomLayer>;
  task: TaskFn<CustomLayer>;
  /** Advances started animations to player time `now` (ms). */
  frame(now: number): void;
}

/** Creates the SMIL playback parts of one `svg` plugin instance. */
export function createSmilPlayback(options: SmilPlaybackOptions = {}): SmilPlayback {
  const mounted = new Map<CustomLayer, Live>();
  const ownClock = options.liveClock !== "player";

  const unmount = (layer: CustomLayer): void => {
    const state = mounted.get(layer);
    if (!state) return;
    state.observer?.disconnect();
    pause(state.svg);
    state.wrapper.remove();
    mounted.delete(layer);
  };

  const renderer: LayerRenderer<CustomLayer> = {
    mount(layer, container, stage) {
      unmount(layer);
      const doc = container.ownerDocument;
      const wrapper = doc.createElement("div");
      wrapper.style.cssText = "position:absolute;inset:0;opacity:0";
      // The live copy covers the woven skeleton exactly, on the drawing's own background (never a URL).
      const background = String(stage.blueprint.background ?? "");
      if (!/url\(|image-set|\\/i.test(background)) wrapper.style.background = background;
      const svg = buildSvg(layer, doc);
      if (!svg) return wrapper;
      // Own shadow root: the drawing's <style> rules and ids must not reach the woven layers.
      (typeof wrapper.attachShadow === "function" ? wrapper.attachShadow({ mode: "open" }) : wrapper).appendChild(svg);
      pause(svg);
      seek(svg, 0);
      // On player time the live switch changes nothing, so there is nothing to watch.
      const host = ownClock ? worldHost(container) : null;
      const View = doc.defaultView?.MutationObserver;
      const observer = host && View ? new View(() => applyLive(state, host.hasAttribute("data-live"))) : null;
      const state: Live = { svg, wrapper, observer, started: false, t0: null, live: !!host?.hasAttribute("data-live") };
      if (host) observer?.observe(host, { attributes: true, attributeFilter: ["data-live"] });
      mounted.set(layer, state);
      return wrapper;
    },
    reveal(layer, p) {
      const state = mounted.get(layer);
      if (state) state.wrapper.style.opacity = String(p);
    },
    finish(layer) {
      const state = mounted.get(layer);
      if (!state) return;
      state.wrapper.style.opacity = "1";
      start(state);
    },
    unmount,
  };

  const task: TaskFn<CustomLayer> = function* (agent, layer, stage: StageApi) {
    // A short "press play" in the visible part of the drawing, then the cross-fade.
    const vp = stage.viewport();
    const b = layer.box;
    const x = Math.max(b.x, Math.min(b.x + b.w, vp.x + vp.w / 2));
    const y = Math.max(b.y, Math.min(b.y + b.h, vp.y + vp.h / 2));
    yield* agent.moveTo(x, y);
    agent.setCursor("hand");
    agent.press();
    agent.sound("press");
    yield 90;
    agent.release();
    agent.sound("release");
    agent.setCursor("arrow");
    for (let t = 0; t < FADE_MS; t += FADE_STEP_MS) {
      stage.reveal(layer.id, t / FADE_MS);
      yield FADE_STEP_MS;
    }
    stage.finish(layer.id);
  };

  return {
    renderer,
    task,
    frame(now) {
      for (const state of mounted.values()) {
        if (!state.started || state.live) continue;
        state.t0 ??= now;
        seek(state.svg, Math.max(0, now - state.t0) / 1000);
      }
    },
  };
}
