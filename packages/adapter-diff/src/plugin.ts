/**
 * The `diff` plugin: one custom layer per diff line. Context lines fade in, added lines are typed,
 * removed lines are struck through, selected and deleted with backspace (they stay as a dimmed,
 * struck ghost so the review panel keeps both sides).
 */

import {
  type CustomLayer,
  definePlugin,
  type LayerRenderer,
  type Plugin,
  type TaskFn,
  type TaskGen,
} from "@swarmloom/core";
import type { LineKind } from "./parse";

export const DIFF_PLUGIN = "diff";
export const LINE_TASK = "diff:line";

/** Data of a `diff:line` custom layer. */
export interface DiffLineData {
  v: 1;
  kind: LineKind;
  /** Line text with tabs expanded (one column per character cell). */
  text: string;
  oldNo?: number;
  newNo?: number;
  noNewline?: boolean;
  /** Width of one line-number column, px. */
  numW: number;
  /** Width of the +/- column, px. */
  signW: number;
  /** Advance of one monospace cell, px. */
  cellW: number;
  /** Author label shown while the first change of a hunk is built. */
  author?: string;
}

const KINDS = new Set<LineKind>(["context", "add", "del"]);
/** Typing of one added line never takes longer than this, ms. */
const MAX_TYPE_MS = 3500;

/** Validates `diff:line` data (custom layer data comes from a blueprint that may be hand-edited). */
export function readLineData(raw: unknown): DiffLineData | null {
  const d = raw as Partial<DiffLineData> | null;
  if (!d || typeof d !== "object" || d.v !== 1 || !KINDS.has(d.kind as LineKind) || typeof d.text !== "string")
    return null;
  for (const k of ["numW", "signW", "cellW"] as const) {
    const n = d[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 400) return null;
  }
  for (const k of ["oldNo", "newNo"] as const) {
    if (d[k] !== undefined && !(Number.isInteger(d[k]) && (d[k] as number) >= 0)) return null;
  }
  if (d.author !== undefined && typeof d.author !== "string") return null;
  return d as DiffLineData;
}

function graphemes(text: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  return Array.from(text);
}

interface RowView {
  row: HTMLElement;
  code: HTMLElement;
  strike: HTMLElement;
  sel: HTMLElement;
  chars: string[];
  data: DiffLineData;
  p: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function paint(view: RowView, p: number): void {
  view.p = p;
  const { row, code, strike, sel, chars, data } = view;
  row.style.opacity = p > 0 ? "1" : "0";
  if (data.kind === "context") {
    row.style.opacity = String(clamp01(p));
    return;
  }
  if (data.kind === "add") {
    const n = p >= 1 ? chars.length : Math.floor(chars.length * clamp01((p - 0.05) / 0.95));
    const text = chars.slice(0, n).join("");
    if (code.textContent !== text) code.textContent = text;
    row.classList.toggle("sld-typing", p > 0 && p < 1);
    return;
  }
  // Removed line: strike sweep (0.1..0.45), selection (0.45..0.7), backspace ghost (0.7..1).
  strike.style.transform = `scaleX(${clamp01((p - 0.1) / 0.35)})`;
  sel.style.opacity = p >= 0.45 && p < 0.72 ? "1" : "0";
  code.style.opacity = String(1 - 0.62 * clamp01((p - 0.7) / 0.3));
  row.classList.toggle("sld-gone", p >= 1);
}

/** Creates the diff plugin (stateless apart from mounted rows; one instance may serve many players). */
export function createDiffPlugin(): Plugin {
  const views = new Map<CustomLayer, RowView>();
  /** Progress survives virtualization: a remounted row comes back as it was. */
  const progress = new WeakMap<CustomLayer, number>();

  const renderer: LayerRenderer<CustomLayer> = {
    mount(layer, container) {
      const data = readLineData(layer.data);
      if (!data) return undefined;
      const doc = container.ownerDocument;
      const row = doc.createElement("div");
      row.className = `sld-row sld-${data.kind}`;
      const num = (n: number | undefined): HTMLElement => {
        const el = doc.createElement("span");
        el.className = "sld-num";
        el.style.width = `${data.numW}px`;
        el.textContent = n === undefined ? "" : String(n);
        return el;
      };
      const sign = doc.createElement("span");
      sign.className = "sld-sign";
      sign.style.width = `${data.signW}px`;
      sign.textContent = data.kind === "add" ? "+" : data.kind === "del" ? "-" : "";
      const body = doc.createElement("span");
      body.className = "sld-body";
      const code = doc.createElement("span");
      code.className = "sld-code";
      code.textContent = data.kind === "add" ? "" : data.text;
      const strike = doc.createElement("span");
      strike.className = "sld-strike";
      strike.style.width = `${Math.max(data.cellW, data.text.length * data.cellW)}px`;
      const sel = doc.createElement("span");
      sel.className = "sld-sel";
      sel.style.width = `${Math.max(data.cellW, data.text.length * data.cellW)}px`;
      body.append(sel, code);
      if (data.kind === "del") body.append(strike);
      if (data.noNewline) {
        const eof = doc.createElement("span");
        eof.className = "sld-eof";
        eof.title = "No newline at end of file";
        eof.textContent = "␀";
        body.append(eof);
      }
      row.append(num(data.oldNo), num(data.newNo), sign, body);
      container.append(row);
      const view: RowView = { row, code, strike, sel, chars: graphemes(data.text), data, p: 0 };
      views.set(layer, view);
      paint(view, progress.get(layer) ?? 0);
      return row;
    },
    reveal(layer, p) {
      progress.set(layer, p);
      const view = views.get(layer);
      if (view) paint(view, p);
    },
    finish(layer) {
      progress.set(layer, 1);
      const view = views.get(layer);
      if (view) paint(view, 1);
    },
    unmount(layer) {
      views.get(layer)?.row.remove();
      views.delete(layer);
    },
  };

  const task: TaskFn<CustomLayer> = function* (agent, layer, stage): TaskGen {
    const data = readLineData(layer.data);
    const b = layer.box;
    let pressed = false;
    try {
      if (!data) return;
      const codeX = b.x + 2 * data.numW + data.signW;
      const midY = b.y + b.h / 2;
      if (data.author) agent.say(data.author);
      if (data.kind === "context") {
        yield* agent.moveTo(codeX + Math.min(b.w - 2 * data.numW, data.text.length * data.cellW) * 0.4, midY);
        for (const p of [0.3, 0.65, 1]) {
          stage.reveal(layer.id, p);
          yield 45;
        }
        return;
      }
      if (data.kind === "add") {
        yield* agent.moveTo(codeX + 2, midY);
        agent.setCursor("ibeam");
        stage.reveal(layer.id, 0.05);
        const chars = graphemes(data.text);
        const per = 24 + agent.rng() * 18;
        const chunk = Math.max(1, Math.ceil((chars.length * per) / MAX_TYPE_MS));
        let col = 0;
        for (let n = 0; n < chars.length; n += chunk) {
          const end = Math.min(chars.length, n + chunk);
          stage.reveal(layer.id, 0.05 + 0.95 * (end / Math.max(1, chars.length)));
          const ch = chars[end - 1] as string;
          agent.sound(ch === " " ? "space" : "key", { vel: 0.45 + agent.rng() * 0.25 });
          col = end;
          yield per * (0.75 + agent.rng() * 0.5);
          if (col % 10 < chunk) yield* agent.moveTo(codeX + col * data.cellW + 2, midY, { dur: 60, ease: "out" });
        }
        return;
      }
      // Removed line: strike through it like a pen, select it, delete it.
      const width = Math.max(data.cellW * 2, Math.min(b.w - 2 * data.numW - data.signW, data.text.length * data.cellW));
      yield* agent.moveTo(codeX, midY);
      agent.setCursor("pen");
      agent.press();
      pressed = true;
      agent.sound("pen");
      const segments = 4;
      for (let s = 1; s <= segments; s++) {
        yield* agent.dragTo(codeX + (width * s) / segments, midY, { dur: 70 + width / 12, ease: "linear" });
        stage.reveal(layer.id, 0.1 + (0.35 * s) / segments);
      }
      agent.release();
      pressed = false;
      agent.sound("release");
      agent.setCursor("ibeam");
      yield 90 + agent.rng() * 60;
      // Double click selects the line.
      for (let k = 0; k < 2; k++) {
        agent.press();
        agent.sound("press");
        yield 40;
        agent.release();
        yield 50;
      }
      stage.reveal(layer.id, 0.5);
      yield 160 + agent.rng() * 80;
      agent.sound("key", { vel: 0.7 });
      for (const p of [0.75, 0.88, 1]) {
        stage.reveal(layer.id, p);
        yield 50;
      }
    } finally {
      if (pressed) agent.release();
      if (data?.author) agent.say("");
      agent.setCursor("arrow");
      stage.finish(layer.id);
    }
  };

  return definePlugin({
    name: DIFF_PLUGIN,
    tasks: { [LINE_TASK]: task },
    renderers: { [LINE_TASK]: renderer },
  });
}

/** A shared plugin instance for hosts that resolve plugins by name. */
export const diffPlugin: Plugin = createDiffPlugin();
