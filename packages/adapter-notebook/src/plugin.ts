/**
 * The `notebook` plugin: the run indicator of a code cell. A weaver clicks the cell's prompt, the
 * prompt shows `[*]` with a progress line while the cell "runs", then settles on the execution
 * count. The cell's outputs are children of this layer, so they appear only after the run.
 */

import {
  type CustomLayer,
  definePlugin,
  type LayerRenderer,
  type Plugin,
  type TaskFn,
  type TaskGen,
} from "@swarmloom/core";
import { MONO_FONT } from "./theme";

/** Plugin name listed in `Blueprint.plugins`. */
export const NOTEBOOK_PLUGIN = "notebook";
/** Custom layer task of a code cell's run indicator. */
export const RUN_TASK = "notebook:run";

/** Data of a run layer. */
export interface RunData {
  /** Execution count shown when the run ends (null: `[ ]`). */
  count: number | null;
  /** Simulated run time before jitter, ms (clamped to 100..4000). */
  ms: number;
  /** The cell raised an error: the prompt settles in the error colour. */
  error: boolean;
  /** Prompt colour while running and afterwards. */
  color: string;
  /** Prompt colour after an error. */
  errorColor: string;
  /** Narrow layouts drop the "In" label. */
  compact: boolean;
}

/** Reads and validates the data of a run layer. */
export function readRunData(layer: CustomLayer): RunData | null {
  const d = layer.data as Partial<RunData> | undefined;
  if (!d || typeof d !== "object") return null;
  const count = d.count === null || (Number.isInteger(d.count) && (d.count as number) >= 0) ? d.count : undefined;
  if (count === undefined || typeof d.ms !== "number" || !Number.isFinite(d.ms)) return null;
  const hex = /^#[0-9a-f]{6}$/i;
  return {
    count,
    ms: Math.min(4000, Math.max(100, d.ms)),
    error: d.error === true,
    color: typeof d.color === "string" && hex.test(d.color) ? d.color : "#5B5BF7",
    errorColor: typeof d.errorColor === "string" && hex.test(d.errorColor) ? d.errorColor : "#E23D68",
    compact: d.compact === true,
  };
}

/** Prompt text: `In [7]:`, `In [*]:` while running, `[7]:` when compact. */
export function promptText(data: RunData, state: "idle" | "running" | "done"): string {
  const inner = state === "running" ? "*" : state === "done" && data.count !== null ? String(data.count) : " ";
  return `${data.compact ? "" : "In "}[${inner}]:`;
}

interface RunView {
  root: HTMLElement;
  label: HTMLElement;
  bar: HTMLElement;
  data: RunData;
}

/**
 * Creates a notebook plugin instance. Each instance keeps its own views; players that share a
 * blueprint object should use separate instances.
 */
export function createNotebookPlugin(): Plugin {
  const views = new Map<CustomLayer, RunView>();

  const renderer: LayerRenderer<CustomLayer> = {
    mount(layer, container) {
      const data = readRunData(layer);
      if (!data) return undefined;
      views.get(layer)?.root.remove();
      const doc = container.ownerDocument;
      const root = doc.createElement("div");
      root.setAttribute("role", "status");
      root.style.cssText = `position:relative;width:100%;height:100%;font:600 12px/20px ${MONO_FONT};color:${data.color};text-align:right;white-space:pre;padding-right:6px;box-sizing:border-box;opacity:0`;
      const label = doc.createElement("span");
      label.textContent = promptText(data, "idle");
      const bar = doc.createElement("span");
      bar.style.cssText =
        "position:absolute;right:6px;bottom:0;height:2px;width:0;border-radius:1px;background:currentColor;opacity:.7";
      root.append(label, bar);
      container.append(root);
      views.set(layer, { root, label, bar, data });
      return root;
    },
    reveal(layer, p) {
      const v = views.get(layer);
      if (!v) return;
      const t = Math.min(1, Math.max(0, p));
      v.root.style.opacity = "1";
      v.label.textContent = promptText(v.data, "running");
      v.bar.style.width = `${Math.round(t * 70)}%`;
    },
    finish(layer) {
      const v = views.get(layer);
      if (!v) return;
      v.root.style.opacity = "1";
      v.root.style.color = v.data.error ? v.data.errorColor : v.data.color;
      v.label.textContent = promptText(v.data, "done");
      v.bar.style.width = "0";
    },
    unmount(layer) {
      views.get(layer)?.root.remove();
      views.delete(layer);
    },
  };

  /** Click the prompt, show the run, settle on the execution count. */
  const runTask: TaskFn<CustomLayer> = function* (agent, layer, stage): TaskGen {
    const data = readRunData(layer);
    if (!data) {
      stage.finish(layer.id);
      return;
    }
    let pressed = false;
    try {
      const b = layer.box;
      yield* agent.moveTo(b.x + b.w - 14, b.y + b.h / 2, { dur: 280, ease: "inOut" });
      agent.setCursor("hand");
      agent.press();
      agent.sound("press");
      pressed = true;
      yield 60 + agent.rng() * 40;
      agent.release();
      agent.sound("release");
      pressed = false;
      agent.setCursor("arrow");
      agent.say("running");
      stage.reveal(layer.id, 0);
      const total = data.ms * (0.85 + agent.rng() * 0.3);
      for (let t = 0; t < total; ) {
        const step = Math.min(120, total - t);
        yield step;
        t += step;
        stage.reveal(layer.id, Math.min(1, t / total));
      }
      agent.sound("pop", { vel: data.error ? 0.4 : 0.6 });
    } finally {
      if (pressed) agent.release();
      agent.say("");
      agent.setCursor("arrow");
      stage.finish(layer.id);
    }
  };

  return definePlugin({
    name: NOTEBOOK_PLUGIN,
    tasks: { [RUN_TASK]: runTask },
    renderers: { [RUN_TASK]: renderer },
  });
}

/** A shared plugin instance for hosts that resolve plugins by name. */
export const notebookPlugin: Plugin = createNotebookPlugin();
