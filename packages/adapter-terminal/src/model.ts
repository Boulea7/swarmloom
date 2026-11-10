/**
 * Playback state of one terminal screen layer, shared by the screen renderer (which draws it)
 * and the step layers (whose reveal progress decides how far the recording has played).
 */

import { escapeHtml } from "./ansi/html";
import { normalizeHex, type TerminalTheme } from "./ansi/palette";
import { attrsCss } from "./ansi/sgr";
import { MAX_COLS, MAX_ROWS, Screen } from "./screen";
import type { PlayKind } from "./timeline";

/** One playback event: time (ms), kind, data, and 1 when it is a keystroke (plays a key sound). */
export type ScreenEvent = [t: number, kind: PlayKind, data: string, key: 0 | 1];

/** `CustomLayer.data` of the `terminal:screen` layer. Plain JSON, so blueprints can be stored. */
export interface TerminalScreenData {
  v: 1;
  cols: number;
  rows: number;
  /** Cell size and font size in stage px. */
  cellW: number;
  cellH: number;
  fontSize: number;
  /** CSS font-family list. */
  font: string;
  theme: TerminalTheme;
  events: ScreenEvent[];
  /** Playback window [t0, t1] of every step, in step order. */
  steps: [number, number][];
}

/** `CustomLayer.data` of a `terminal:step` layer. */
export interface TerminalStepData {
  /** Id of the screen layer the step plays on. */
  screen: string;
  /** Index into `TerminalScreenData.steps`. */
  index: number;
  /** Event index range [from, to). */
  from: number;
  to: number;
  /** True for a typing step. */
  input: boolean;
}

const MAX_EVENTS = 500_000;
const MAX_STEPS = 50_000;
const KINDS = new Set(["o", "i", "r"]);

function finitePositive(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
}

/**
 * Validates screen data read from a blueprint (which may come from storage or another origin).
 * Returns null when it is unusable.
 */
export function readScreenData(raw: unknown): TerminalScreenData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<TerminalScreenData>;
  if (d.v !== 1 || !Number.isInteger(d.cols) || !Number.isInteger(d.rows)) return null;
  if (!finitePositive(d.cols, MAX_COLS) || !finitePositive(d.rows, MAX_ROWS)) return null;
  if (!finitePositive(d.cellW, 200) || !finitePositive(d.cellH, 400) || !finitePositive(d.fontSize, 200)) return null;
  if (typeof d.font !== "string" || d.font.length > 400 || /[;{}<>]/.test(d.font)) return null;
  const theme = d.theme;
  const fg = normalizeHex(theme?.fg);
  const bg = normalizeHex(theme?.bg);
  const palette = Array.isArray(theme?.palette) ? theme.palette.map(normalizeHex) : [];
  if (!fg || !bg || palette.length !== 16 || palette.some((c) => c === null)) return null;
  if (!Array.isArray(d.events) || d.events.length > MAX_EVENTS) return null;
  if (!Array.isArray(d.steps) || d.steps.length > MAX_STEPS) return null;
  let last = 0;
  for (const e of d.events) {
    if (!Array.isArray(e) || typeof e[0] !== "number" || !(e[0] >= last) || !KINDS.has(e[1] as string)) return null;
    if (typeof e[2] !== "string" || (e[3] !== 0 && e[3] !== 1)) return null;
    last = e[0];
  }
  for (const s of d.steps) {
    if (!Array.isArray(s) || typeof s[0] !== "number" || typeof s[1] !== "number" || !(s[1] >= s[0])) return null;
  }
  return { ...(d as TerminalScreenData), theme: { fg, bg, palette: palette as string[] } };
}

/** Something that draws a model (the DOM view). */
export interface ModelView {
  render(): void;
}

export class TerminalModel {
  readonly data: TerminalScreenData;
  #screen: Screen;
  /** Index of the last event applied to the screen. */
  #applied = -1;
  readonly #progress: Float64Array;
  readonly #views = new Set<ModelView>();
  /** Bumped whenever the screen object is replaced (seeking backwards). */
  generation = 0;
  /** Bumped whenever a keystroke event is applied (the caret stays solid while typing). */
  keyStamp = 0;

  constructor(data: TerminalScreenData) {
    this.data = data;
    this.#screen = new Screen(data.cols, data.rows);
    this.#progress = new Float64Array(data.steps.length);
  }

  get screen(): Screen {
    return this.#screen;
  }

  /** Playback time shown now: the latest step with progress decides; -1 before any step started. */
  time(): number {
    const steps = this.data.steps;
    for (let k = this.#progress.length - 1; k >= 0; k--) {
      const p = this.#progress[k] as number;
      if (p > 0) {
        const [t0, t1] = steps[k] as [number, number];
        return t0 + p * (t1 - t0);
      }
    }
    return -1;
  }

  /** Sets the reveal progress (0..1) of step `index` and redraws the attached views. 0 also resets later steps. */
  setStep(index: number, p: number): void {
    if (!(index >= 0 && index < this.#progress.length)) return;
    const v = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
    if (this.#progress[index] === v && (v > 0 || this.#progress.every((q, i) => i <= index || q === 0))) return;
    this.#progress[index] = v;
    // Steps are chained: resetting one (a replay remount) also resets every later step.
    if (v === 0) for (let i = index + 1; i < this.#progress.length; i++) this.#progress[i] = 0;
    this.seek(this.time());
    for (const view of this.#views) view.render();
  }

  /** Applies every event with `t <= time` (replaying from the start when going backwards). */
  seek(time: number): void {
    const events = this.data.events;
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((events[mid] as ScreenEvent)[0] <= time) lo = mid + 1;
      else hi = mid;
    }
    const target = lo - 1;
    if (target < this.#applied) {
      this.#screen = new Screen(this.data.cols, this.data.rows);
      this.#applied = -1;
      this.generation++;
    }
    while (this.#applied < target) {
      this.#applied++;
      const [, kind, data, key] = events[this.#applied] as ScreenEvent;
      if (kind === "o") this.#screen.write(data);
      else if (kind === "r") {
        const m = /^(\d{1,4})x(\d{1,4})$/.exec(data);
        if (m) {
          this.#screen.resize(Math.min(Number(m[1]), this.data.cols), Math.min(Number(m[2]), this.data.rows));
        }
      }
      if (key === 1) this.keyStamp++;
    }
  }

  attach(view: ModelView): void {
    this.#views.add(view);
  }

  detach(view: ModelView): void {
    this.#views.delete(view);
  }
}

const ROW_STYLE =
  ".slt-row{height:var(--slt-h);white-space:pre;overflow:hidden}" +
  ".slt-row>span{display:inline-block;height:100%;vertical-align:top;overflow:hidden}" +
  ".slt-caret{position:absolute;left:0;top:0;width:var(--slt-w);height:var(--slt-h);pointer-events:none}";

/** Caret blink half-period and how long it stays solid after a keystroke (engine ms). */
const BLINK_MS = 530;
const SOLID_AFTER_KEY_MS = 500;

/** DOM view of a model: one row element per screen row plus a block caret. */
export class TerminalView implements ModelView {
  readonly root: HTMLElement;
  readonly #model: TerminalModel;
  #rows: HTMLElement[] = [];
  #versions: number[] = [];
  #generation = -1;
  readonly #caret: HTMLElement;
  #keyStamp = -1;
  #lastKeyAt = Number.NEGATIVE_INFINITY;
  #caretOn = true;
  #caretShown = true;

  constructor(model: TerminalModel, doc: Document) {
    this.#model = model;
    const d = model.data;
    this.root = doc.createElement("div");
    this.root.setAttribute("role", "log");
    this.root.setAttribute("aria-label", "Terminal");
    this.root.style.cssText = [
      "position:relative",
      "width:100%",
      "height:100%",
      "overflow:hidden",
      `color:${d.theme.fg}`,
      `font-family:${d.font}`,
      `font-size:${d.fontSize}px`,
      `line-height:${d.cellH}px`,
      "font-variant-ligatures:none",
      "font-kerning:none",
      "text-rendering:optimizeSpeed",
      `--slt-w:${d.cellW}px`,
      `--slt-h:${d.cellH}px`,
    ].join(";");
    const style = doc.createElement("style");
    style.textContent = ROW_STYLE;
    this.root.append(style);
    this.#caret = doc.createElement("div");
    this.#caret.className = "slt-caret";
    this.#caret.style.background = d.theme.fg;
    this.#caret.style.opacity = "0.72";
    this.root.append(this.#caret);
  }

  /** Redraws rows whose content changed and moves the caret. */
  render(): void {
    const model = this.#model;
    const screen = model.screen;
    const doc = this.root.ownerDocument;
    if (this.#rows.length !== screen.rows || this.#generation !== model.generation) {
      for (const row of this.#rows) row.remove();
      this.#rows = Array.from({ length: screen.rows }, () => {
        const row = doc.createElement("div");
        row.className = "slt-row";
        this.root.insertBefore(row, this.#caret);
        return row;
      });
      this.#versions = new Array<number>(screen.rows).fill(-1);
      this.#generation = model.generation;
    }
    const { cellW, theme } = model.data;
    for (let y = 0; y < screen.rows; y++) {
      const version = screen.rowVersion(y);
      if (version === this.#versions[y]) continue;
      this.#versions[y] = version;
      let html = "";
      for (const run of screen.runs(y)) {
        const css = attrsCss(run.attrs, theme);
        html += `<span style="width:${(run.cols * cellW).toFixed(2)}px${css ? `;${css}` : ""}">${escapeHtml(run.text)}</span>`;
      }
      (this.#rows[y] as HTMLElement).innerHTML = html;
    }
    this.#caret.style.transform = `translate(${(screen.x * cellW).toFixed(2)}px,${screen.y * model.data.cellH}px)`;
    this.#updateCaret();
  }

  /** Caret blink driven by engine time (deterministic in exports). */
  tick(now: number): void {
    if (this.#model.keyStamp !== this.#keyStamp) {
      this.#keyStamp = this.#model.keyStamp;
      this.#lastKeyAt = now;
    }
    this.#caretOn = now - this.#lastKeyAt < SOLID_AFTER_KEY_MS || Math.floor(now / BLINK_MS) % 2 === 0;
    this.#updateCaret();
  }

  #updateCaret(): void {
    const show = this.#caretOn && this.#model.screen.cursorVisible && this.#model.time() >= 0;
    if (show === this.#caretShown) return;
    this.#caretShown = show;
    this.#caret.style.visibility = show ? "visible" : "hidden";
  }
}
