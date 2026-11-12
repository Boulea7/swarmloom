/**
 * Terminal recording -> Blueprint: a window (frame, title bar, three window dots, title), the
 * screen custom layer, and one step layer per playback step, chained so they play in order.
 */

import type { Blueprint, BoxLayer, CustomLayer, Layer, Rect, TextLayer } from "@swarmloom/core";
import { LOOM_INK, type TerminalTheme } from "./ansi/palette";
import type { CastRecording } from "./cast";
import type { ScreenEvent, TerminalScreenData, TerminalStepData } from "./model";
import { SCREEN_TASK, STEP_TASK, TERMINAL_PLUGIN } from "./plugin";
import { Screen } from "./screen";
import type { PlayEvent, Timeline } from "./timeline";

/** Monospace stack; the first installed face wins. Cell widths are measured, so any face works. */
export const MONO_FONT =
  'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

export interface TerminalLayoutOptions {
  document: Document;
  /** Available layout width (ctx.width). The font shrinks (down to 9 px) to fit it. */
  width: number;
  /** Page scheme around the window. */
  scheme: "light" | "dark";
  /** Preferred font size, px. Default 14. */
  fontSize?: number;
  /** Terminal colours. Default: the recording's theme, else Loom Ink. */
  theme?: TerminalTheme;
  /** Shrink the window to the rows and columns the session uses. Default true. */
  fit?: boolean;
  /**
   * Let the font grow past `fontSize` until the window fills `width`, or `height` when that comes
   * first; the window frame keeps its size. Default false: the font only shrinks to fit `width`.
   */
  fill?: boolean;
  /** Stage height, px, that `fill` keeps the window within. Default: none, only `width` limits it. */
  height?: number;
  /** Window title. Default: recording title, last OSC title, command, shell, file name. */
  title?: string;
  /** File name, used for the source and as a title fallback. */
  name?: string;
}

const MARGIN = 28;
const PAD_X = 14;
const PAD_Y = 12;
const BAR_H = 36;
const DOT = 11;
const DOT_GAP = 8;
const MIN_ROWS = 4;
const MIN_COLS = 40;
const MIN_FONT = 9;
const DEFAULT_FONT = 14;
/** Terminal line height, in ems. */
const LINE_HEIGHT = 1.45;
/** Window dot colours (SwarmLoom palette: coral, amber, teal). */
const DOT_COLORS = ["#FF6B5B", "#F5A524", "#14B8A6"] as const;

function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number): number => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Average advance of a digit in the monospace font, px. Falls back to 0.6 em without canvas. */
export function measureCell(doc: Document, fontSize: number, family: string = MONO_FONT): number {
  let w = 0;
  try {
    const ctx = doc.createElement("canvas").getContext?.("2d");
    if (ctx) {
      ctx.font = `${fontSize}px ${family}`;
      w = ctx.measureText("0123456789".repeat(4)).width / 40;
    }
  } catch {
    w = 0;
  }
  return Number.isFinite(w) && w > fontSize * 0.3 && w < fontSize * 1.2 ? Math.round(w * 100) / 100 : fontSize * 0.6;
}

function parseSize(data: string): [number, number] | null {
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(data);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

interface Usage {
  maxRow: number;
  maxCol: number;
  wrapped: boolean;
  scrolled: boolean;
  alternate: boolean;
  title: string;
}

function feed(screen: Screen, ev: PlayEvent): void {
  if (ev.kind === "o") screen.write(ev.data);
  else if (ev.kind === "r") {
    const size = parseSize(ev.data);
    if (size) screen.resize(Math.min(size[0], screen.cols), Math.min(size[1], screen.rows));
  }
}

function measureUsage(events: readonly PlayEvent[], cols: number, rows: number): Usage {
  const screen = new Screen(cols, rows);
  for (const ev of events) feed(screen, ev);
  return {
    maxRow: screen.maxRow,
    maxCol: screen.maxCol,
    wrapped: screen.wrapped,
    scrolled: screen.scrolledOff > 0,
    alternate: screen.usedAlternate,
    title: screen.title,
  };
}

/** Rows each step changes or puts the cursor on: [first, last]. */
function stepRows(timeline: Timeline, cols: number, rows: number): [number, number][] {
  const screen = new Screen(cols, rows);
  const out: [number, number][] = [];
  for (const step of timeline.steps) {
    const before = Array.from({ length: screen.rows }, (_, y) => screen.rowVersion(y));
    let lo = screen.y;
    let hi = screen.y;
    for (let i = step.from; i < step.to; i++) {
      feed(screen, timeline.events[i] as PlayEvent);
      lo = Math.min(lo, screen.y);
      hi = Math.max(hi, screen.y);
    }
    if (!step.input) {
      for (let y = 0; y < screen.rows; y++) {
        if (screen.rowVersion(y) !== before[y]) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
    }
    out.push([lo, Math.min(hi, rows - 1)]);
  }
  return out;
}

function fallbackTitle(rec: CastRecording, usage: Usage, opts: TerminalLayoutOptions): string {
  const shell = rec.shell?.split("/").pop();
  return opts.title ?? rec.title ?? (usage.title || undefined) ?? rec.command ?? shell ?? opts.name ?? "Terminal";
}

/** Our own icon for the intro orbit: an indigo tile with a prompt chevron and a block caret. */
export function terminalIcon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#5B5BF7"/>' +
    '<path d="M18 22l10 10-10 10" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="33" y="38" width="14" height="6" rx="2" fill="#FF6B5B"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Builds the blueprint of a recording. Pure apart from font measurement through
 * `opts.document` (a canvas 2D context when available).
 */
export function buildTerminalBlueprint(rec: CastRecording, timeline: Timeline, opts: TerminalLayoutOptions): Blueprint {
  let cols = rec.cols;
  let rows = rec.rows;
  let resized = false;
  for (const ev of timeline.events) {
    if (ev.kind !== "r") continue;
    const size = parseSize(ev.data);
    if (!size) continue;
    resized = true;
    cols = Math.max(cols, Math.min(size[0], 400));
    rows = Math.max(rows, Math.min(size[1], 200));
  }
  const usage = measureUsage(timeline.events, cols, rows);
  if (opts.fit !== false && !resized && !usage.alternate) {
    if (!usage.scrolled) rows = Math.max(Math.min(rows, MIN_ROWS), Math.min(rows, usage.maxRow + 1));
    if (!usage.wrapped) cols = Math.max(Math.min(cols, MIN_COLS), Math.min(cols, usage.maxCol + 2));
  }

  const theme = opts.theme ?? rec.theme ?? LOOM_INK;
  const { fontSize, cellW } = cellFont(cols, rows, opts);
  const cellH = lineHeight(fontSize);

  const screenW = Math.ceil(cols * cellW);
  const screenH = rows * cellH;
  const win: Rect = { x: MARGIN, y: MARGIN, w: screenW + 2 * PAD_X, h: BAR_H + screenH + 2 * PAD_Y };
  const barColor = mixHex(theme.bg, "#ffffff", 0.06);
  const titleColor = mixHex(theme.fg, theme.bg, 0.42);
  const layers: Layer[] = [];

  const frame: BoxLayer = {
    id: "term-frame",
    kind: "box",
    role: "section",
    box: win,
    z: 0,
    style: {
      "background-color": theme.bg,
      "border-radius": "12px",
      "box-shadow": "0 24px 60px -24px rgba(11,11,18,0.55), 0 0 0 1px rgba(255,255,255,0.07)",
    },
  };
  const bar: BoxLayer = {
    id: "term-bar",
    kind: "box",
    role: "nav",
    parent: frame.id,
    box: { x: win.x, y: win.y, w: win.w, h: BAR_H },
    z: 1,
    style: {
      "background-color": barColor,
      "border-radius": "12px 12px 0 0",
      "border-bottom": "1px solid rgba(255,255,255,0.06)",
    },
  };
  layers.push(frame, bar);
  const dotY = win.y + (BAR_H - DOT) / 2;
  DOT_COLORS.forEach((color, i) => {
    layers.push({
      id: `term-dot-${i + 1}`,
      kind: "box",
      role: "button",
      parent: bar.id,
      ...(i > 0 ? { master: "term-dot-1" } : {}),
      box: { x: win.x + 16 + i * (DOT + DOT_GAP), y: dotY, w: DOT, h: DOT },
      z: 2,
      style: { "background-color": color, "border-radius": "50%" },
    });
  });
  const dotsEnd = 16 + 3 * DOT + 2 * DOT_GAP + 12;
  const title: TextLayer = {
    id: "term-title",
    kind: "text",
    role: "heading",
    parent: bar.id,
    box: { x: win.x + dotsEnd, y: win.y + (BAR_H - 16) / 2, w: Math.max(40, win.w - 2 * dotsEnd), h: 16 },
    z: 2,
    text: fallbackTitle(rec, usage, opts),
    html: "",
    fontSize: 12,
    reveal: "type",
    style: {
      "font-family": UI_FONT,
      "font-size": "12px",
      "font-weight": "600",
      "line-height": "16px",
      color: titleColor,
      "text-align": "center",
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
    },
  };
  title.html = escapeText(title.text);
  layers.push(title);

  const screenBox: Rect = { x: win.x + PAD_X, y: win.y + BAR_H + PAD_Y, w: screenW, h: screenH };
  const events: ScreenEvent[] = timeline.events.map((e) => [
    Math.round(e.t * 10) / 10,
    e.kind,
    e.data,
    e.typed && (e.kind === "i" || !timeline.recordedInput) ? 1 : 0,
  ]);
  const data: TerminalScreenData = {
    v: 1,
    cols,
    rows,
    cellW,
    cellH,
    fontSize,
    font: MONO_FONT,
    theme: { fg: theme.fg, bg: theme.bg, palette: [...theme.palette] },
    events,
    steps: timeline.steps.map((s) => [Math.round(s.t0 * 10) / 10, Math.round(s.t1 * 10) / 10]),
  };
  const notes: string[] = [];
  if (usage.alternate) notes.push("A full-screen program used the alternate screen; it replays best-effort.");
  if (timeline.scale < 1) notes.push(`Sped up ${(1 / timeline.scale).toFixed(1)}x to fit the playback budget.`);
  const screen: CustomLayer = {
    id: "term-screen",
    kind: "custom",
    task: SCREEN_TASK,
    role: "code",
    parent: frame.id,
    box: screenBox,
    z: 1,
    data,
    meta: { notes, duration: Math.round(timeline.duration) },
  };
  layers.push(screen);

  const rowsOfSteps = stepRows(timeline, cols, rows);
  let previous = screen.id;
  timeline.steps.forEach((step, index) => {
    const [lo, hi] = rowsOfSteps[index] as [number, number];
    const stepData: TerminalStepData = { screen: screen.id, index, from: step.from, to: step.to, input: step.input };
    const layer: CustomLayer = {
      id: `term-step-${index + 1}`,
      kind: "custom",
      task: STEP_TASK,
      parent: previous,
      box: { x: screenBox.x, y: screenBox.y + lo * cellH, w: screenBox.w, h: (hi - lo + 1) * cellH },
      z: 3,
      data: stepData,
      meta: { kind: step.input ? "input" : "output", ms: Math.round(step.t1 - step.t0) },
    };
    layers.push(layer);
    previous = layer.id;
  });

  const blueprint: Blueprint = {
    version: 1,
    source: { type: "terminal", ...(opts.name ? { name: opts.name } : {}), title: title.text },
    size: { w: win.w + 2 * MARGIN, h: win.h + 2 * MARGIN },
    background: opts.scheme === "dark" ? "#0B0B12" : "#FAFAFC",
    scheme: opts.scheme,
    icon: terminalIcon(),
    layers,
    plugins: [TERMINAL_PLUGIN],
  };
  if (rec.skipped > 0)
    blueprint.truncated = {
      reason: `${rec.skipped} malformed or excess event lines were skipped`,
      dropped: rec.skipped,
    };
  return blueprint;
}

function lineHeight(fontSize: number): number {
  return Math.round(fontSize * LINE_HEIGHT);
}

/**
 * Font size and measured cell width for a `cols` x `rows` screen: `fontSize` (14) shrunk to fit the
 * width, or with `fill` grown until the window fills the width or the height.
 */
function cellFont(cols: number, rows: number, opts: TerminalLayoutOptions): { fontSize: number; cellW: number } {
  const preferred = opts.fontSize && opts.fontSize > 0 ? opts.fontSize : DEFAULT_FONT;
  const roomW = opts.width - 2 * PAD_X - 2 * MARGIN;
  const cellW = measureCell(opts.document, preferred);
  if (cols * cellW > roomW) {
    const scale = Math.max(MIN_FONT / preferred, roomW / (cols * cellW));
    const fontSize = Math.max(MIN_FONT, Math.floor(preferred * scale * 10) / 10);
    return { fontSize, cellW: measureCell(opts.document, fontSize) };
  }
  if (!opts.fill) return { fontSize: preferred, cellW };
  const roomH = opts.height && opts.height > 0 ? opts.height - 2 * MARGIN - 2 * PAD_Y - BAR_H : Infinity;
  const grow = Math.min(roomW / (cols * cellW), roomH / (rows * preferred * LINE_HEIGHT));
  // Measured widths and rounded line heights are not quite proportional: step back until it fits.
  for (let size = Math.floor(preferred * grow * 10) / 10; size > preferred; size = Math.round(size * 10 - 1) / 10) {
    const w = measureCell(opts.document, size);
    if (Math.ceil(cols * w) <= roomW && rows * lineHeight(size) <= roomH) return { fontSize: size, cellW: w };
  }
  return { fontSize: preferred, cellW };
}

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
