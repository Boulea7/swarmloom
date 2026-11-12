/**
 * The `terminal` plugin: renders the screen layer and plays the recording through short step
 * layers, each built by one weaver at the recorded pace (keystrokes typed with key sounds, program
 * output watched).
 */

import {
  type AgentApi,
  type CustomLayer,
  definePlugin,
  type LayerRenderer,
  type Plugin,
  type Point,
  type Rect,
  type SoundName,
  type StageApi,
  type TaskFn,
  type TaskGen,
} from "@swarmloom/core";
import { readScreenData, type ScreenEvent, TerminalModel, type TerminalStepData, TerminalView } from "./model";
import { type Grid, restCell, rowEnds, watchCell } from "./spots";
import { plainText } from "./timeline";

/** Plugin name listed in `Blueprint.plugins`. */
export const TERMINAL_PLUGIN = "terminal";
/** Custom layer task of the terminal screen (the rows and the caret). */
export const SCREEN_TASK = "terminal:screen";
/** Custom layer task of one playback step. */
export const STEP_TASK = "terminal:step";

/** Events closer than this are applied together (one frame at 60 fps). */
const TICK_MS = 16;
/** At most this many key sounds per tick, so bursts do not turn into noise. */
const MAX_KEY_SOUNDS = 2;
/** Output steps longer than this show a "running" bubble. */
const RUNNING_BUBBLE_MS = 900;
/** Output that only prints a prompt: line breaks first, then at most this many characters on the new line. */
const PROMPT_CHARS = 16;
/** How often a weaver watching output follows the cursor row. */
const FOLLOW_MS = 700;

function stepData(layer: CustomLayer): TerminalStepData | null {
  const d = layer.data as Partial<TerminalStepData> | undefined;
  if (!d || typeof d.screen !== "string" || !Number.isInteger(d.index) || !Number.isInteger(d.from)) return null;
  if (!Number.isInteger(d.to) || (d.to as number) < (d.from as number)) return null;
  return d as TerminalStepData;
}

/** True when output events [from, to) only start a new line and print a short prompt on it (a continuation prompt). */
function promptOnly(events: readonly ScreenEvent[], from: number, to: number): boolean {
  let text = "";
  for (let k = from; k < to; k++) {
    const ev = events[k] as ScreenEvent;
    if (ev[1] === "o") text += plainText(ev[2]);
  }
  const line = text.replace(/^[\r\n]+/, "");
  return !/[\r\n]/.test(line) && line.length <= PROMPT_CHARS;
}

function keySound(data: string): { name: SoundName; vel: number } {
  const c = data.charAt(0);
  if (c === "\r" || c === "\n") return { name: "space", vel: 0.9 };
  if (c === " ") return { name: "space", vel: 0.6 };
  return { name: "key", vel: 0.55 };
}

/**
 * Creates a terminal plugin instance. Each instance keeps its own playback models and views;
 * players that share a blueprint object should use separate instances.
 */
export function createTerminalPlugin(): Plugin {
  const models = new WeakMap<CustomLayer, TerminalModel | null>();
  const stepModels = new WeakMap<CustomLayer, TerminalModel>();
  const views = new Map<CustomLayer, TerminalView>();
  const liveViews = new Set<TerminalView>();
  /** The screen being played, where idle cursors look for a rest spot. */
  let playing: { model: TerminalModel; box: Rect } | null = null;

  function modelFor(screen: CustomLayer | undefined): TerminalModel | null {
    if (screen?.kind !== "custom" || screen.task !== SCREEN_TASK) return null;
    let model = models.get(screen);
    if (model === undefined) {
      const data = readScreenData(screen.data);
      model = data ? new TerminalModel(data) : null;
      models.set(screen, model);
    }
    return model;
  }

  function screenOf(stage: StageApi, step: TerminalStepData): CustomLayer | undefined {
    const layer = stage.layer(step.screen);
    return layer?.kind === "custom" ? layer : undefined;
  }

  /** Stage point of the text cursor (where an I-beam would sit). */
  function caretPoint(model: TerminalModel, box: Rect): Point {
    const { cellW, cellH } = model.data;
    const s = model.screen;
    return { x: box.x + (s.x + 0.5) * cellW, y: box.y + (s.y + 0.8) * cellH };
  }

  function grid(model: TerminalModel): Grid {
    const { cellW, cellH } = model.data;
    return { cols: model.screen.cols, rows: model.screen.rows, cellW, cellH };
  }

  /**
   * Where a weaver watches output: right of the text above the cursor row (output lands below it),
   * clear of the text its bubble and tag would cover; else a little right of the cursor, inside the screen.
   */
  function watchPoint(model: TerminalModel, box: Rect): Point {
    const { cellW, cellH } = model.data;
    const s = model.screen;
    const cell = watchCell(rowEnds(s), grid(model), s.y);
    if (cell) return { x: box.x + cell.x * cellW, y: box.y + cell.y * cellH };
    const x = Math.min(box.x + box.w - 16, box.x + (s.x + 4) * cellW);
    return { x: Math.max(box.x + 16, x), y: box.y + (s.y + 0.5) * cellH };
  }

  /** A rest spot for an idle cursor on the playing screen, clear of its text, when one is in view. */
  function restSpot(vp: Rect, rng: () => number): Point | null {
    if (!playing) return null;
    const { model, box } = playing;
    const { cellW, cellH } = model.data;
    const cell = restCell(rowEnds(model.screen), grid(model), model.screen.y, rng);
    if (!cell) return null;
    const p = { x: box.x + cell.x * cellW, y: box.y + cell.y * cellH };
    return p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h ? p : null;
  }

  const screenRenderer: LayerRenderer<CustomLayer> = {
    mount(layer, container) {
      const model = modelFor(layer);
      if (!model) return undefined;
      const view = new TerminalView(model, container.ownerDocument);
      views.get(layer)?.root.remove();
      views.set(layer, view);
      liveViews.add(view);
      model.attach(view);
      container.append(view.root);
      view.render();
      return view.root;
    },
    reveal(layer, p) {
      const view = views.get(layer);
      if (view) view.root.style.opacity = String(Math.min(1, Math.max(0, p)));
    },
    finish(layer) {
      const view = views.get(layer);
      if (view) view.root.style.opacity = "1";
    },
    unmount(layer) {
      if (playing && playing.model === models.get(layer)) playing = null;
      const view = views.get(layer);
      if (!view) return;
      modelFor(layer)?.detach(view);
      liveViews.delete(view);
      view.root.remove();
      views.delete(layer);
    },
  };

  const stepRenderer: LayerRenderer<CustomLayer> = {
    mount(layer, _container, stage) {
      const step = stepData(layer);
      const model = step ? modelFor(screenOf(stage, step)) : null;
      if (!step || !model) return undefined;
      stepModels.set(layer, model);
      // A freshly mounted step has not been built yet (steps hold no DOM, so they are never virtualized).
      model.setStep(step.index, 0);
      return undefined;
    },
    reveal(layer, p) {
      const step = stepData(layer);
      if (step) stepModels.get(layer)?.setStep(step.index, p);
    },
    finish(layer) {
      const step = stepData(layer);
      if (step) stepModels.get(layer)?.setStep(step.index, 1);
    },
    unmount(layer) {
      stepModels.delete(layer);
    },
  };

  /** Focus click on the empty screen, then the screen fades in. */
  const screenTask: TaskFn<CustomLayer> = function* (agent, layer, stage): TaskGen {
    let pressed = false;
    const model = modelFor(layer);
    if (model) playing = { model, box: layer.box };
    try {
      const b = layer.box;
      yield* agent.moveTo(b.x + Math.min(48, b.w * 0.2), b.y + Math.min(28, b.h * 0.5));
      agent.press();
      agent.sound("press");
      pressed = true;
      yield 50 + agent.rng() * 30;
      agent.release();
      agent.sound("release");
      pressed = false;
      stage.reveal(layer.id, 0.4);
      yield 90;
      stage.reveal(layer.id, 0.8);
      yield 90;
    } finally {
      if (pressed) agent.release();
      stage.finish(layer.id);
    }
  };

  /** Plays one step at the recorded pace. */
  const stepTask: TaskFn<CustomLayer> = function* (agent, layer, stage): TaskGen {
    const step = stepData(layer);
    const screen = step ? screenOf(stage, step) : undefined;
    const model = modelFor(screen);
    if (!step || !screen || !model) {
      stage.finish(layer.id);
      return;
    }
    const [t0, t1] = model.data.steps[step.index] ?? [0, 0];
    const events = model.data.events;
    const box = screen.box;
    const span = t1 - t0;
    playing = { model, box };
    // A continuation prompt between two typed lines prints where the typing cursor already is.
    const onScreen = agent.x >= box.x && agent.x <= box.x + box.w && agent.y >= box.y && agent.y <= box.y + box.h;
    const inPlace = !step.input && onScreen && promptOnly(events, step.from, step.to);
    try {
      let now = t0;
      if (!inPlace) {
        const start = step.input ? caretPoint(model, box) : watchPoint(model, box);
        const firstAt = (events[step.from] as ScreenEvent | undefined)?.[0] ?? t1;
        const travel = Math.max(120, Math.min(420, firstAt - t0 - 40));
        yield* agent.moveTo(start.x, start.y, { dur: travel, ease: "inOut" });
        now += travel;
        agent.setCursor(step.input ? "ibeam" : "arrow");
      }
      // The I-beam and the key sounds show typing; a bubble there would cover the line above the caret.
      agent.say(!step.input && span > RUNNING_BUBBLE_MS ? "running" : "");
      let lastFollow = now;
      let i = step.from;
      while (i < step.to) {
        const tickAt = (events[i] as ScreenEvent)[0];
        let j = i;
        while (j < step.to && (events[j] as ScreenEvent)[0] - tickAt < TICK_MS) j++;
        if (tickAt > now) {
          yield tickAt - now;
          now = tickAt;
        }
        const lastAt = (events[j - 1] as ScreenEvent)[0];
        stage.reveal(layer.id, span > 0 ? (lastAt - t0) / span : 1);
        playKeys(agent, events, i, j);
        if (step.input) {
          const c = caretPoint(model, box);
          if (Math.abs(c.x - agent.x) > 1 || Math.abs(c.y - agent.y) > 1) {
            yield* agent.moveTo(c.x, c.y, { dur: 40, ease: "out" });
            now += 40;
          }
        } else if (!inPlace && now - lastFollow > FOLLOW_MS) {
          const w = watchPoint(model, box);
          if (Math.abs(w.x - agent.x) > 1 || Math.abs(w.y - agent.y) > 1) {
            yield* agent.moveTo(w.x, w.y, { dur: 220, ease: "inOut" });
            now += 220;
          }
          lastFollow = now;
        }
        i = j;
      }
    } finally {
      agent.say("");
      if (!inPlace) agent.setCursor("arrow");
      stage.finish(layer.id);
    }
  };

  /** Key sounds of the keystrokes in events [from, to). */
  function playKeys(agent: AgentApi, events: readonly ScreenEvent[], from: number, to: number): void {
    let sounds = 0;
    for (let k = from; k < to && sounds < MAX_KEY_SOUNDS; k++) {
      const ev = events[k] as ScreenEvent;
      if (ev[3] !== 1) continue;
      const { name, vel } = keySound(ev[2]);
      agent.sound(name, { vel: vel * (0.85 + agent.rng() * 0.3) });
      sounds++;
    }
  }

  return definePlugin({
    name: TERMINAL_PLUGIN,
    tasks: { [SCREEN_TASK]: screenTask, [STEP_TASK]: stepTask },
    renderers: { [SCREEN_TASK]: screenRenderer, [STEP_TASK]: stepRenderer },
    frame(now) {
      for (const view of liveViews) view.tick(now);
    },
    restSpot,
  });
}

/** A shared plugin instance for hosts that resolve plugins by name. */
export const terminalPlugin: Plugin = createTerminalPlugin();
