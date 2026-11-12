/**
 * Playback timeline of a recording: idle gaps capped (like asciinema's idle time limit), the
 * whole session fitted into a time budget, keystrokes told apart from program output, and the
 * session cut into short steps that the swarm builds one after another.
 */

import type { CastEvent, CastRecording } from "./cast";

/** Event kinds kept for playback: output, input, resize. */
export type PlayKind = "o" | "i" | "r";

export interface PlayEvent {
  /** Playback time, engine ms at speed 1. */
  t: number;
  kind: PlayKind;
  data: string;
  /** A keystroke: an input event, or (without input events) output that looks like typing echo. */
  typed: boolean;
}

export interface Step {
  /** Index range [from, to) into the timeline events. */
  from: number;
  to: number;
  /** Playback start (end of the previous step) and end (time of the step's last event). */
  t0: number;
  t1: number;
  /** True when the step contains keystrokes. */
  input: boolean;
}

export interface Timeline {
  events: PlayEvent[];
  steps: Step[];
  /** Total playback duration, ms. */
  duration: number;
  /** Uniform factor applied after capping idle gaps to fit `maxDuration` (1 = untouched). */
  scale: number;
  /** True when the recording has input (`i`) events. */
  recordedInput: boolean;
}

export interface TimelineOptions {
  /** Longest pause kept between two events, ms. Default 1500 (lowered by the header's limit). */
  idleLimit?: number;
  /** Longest pause before the first event, ms. Default 400. */
  startLimit?: number;
  /** Playback budget; longer sessions are sped up uniformly. Default 60 000 ms. */
  maxDuration?: number;
  /** Speed factor applied before the budget (2 = twice as fast). Default 1. */
  speed?: number;
  /** Longest step, ms. Keeps every task short enough for the engine's watchdog. Default 6000. */
  maxStep?: number;
  /** Most events per step. Default 1500. */
  maxStepEvents?: number;
}

const DEFAULTS = {
  idleLimit: 1500,
  startLimit: 400,
  maxDuration: 60_000,
  speed: 1,
  maxStep: 6000,
  maxStepEvents: 1500,
};

function positive(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences.
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[ -/]*[0-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: printable text only (no C0/C1 controls).
const PRINTABLE_SHORT = /^[^\u0000-\u001f\u007f-\u009f]{1,3}$/u;

/** Terminal output without its escape sequences. */
export function plainText(data: string): string {
  return data.replace(ESCAPES, "");
}

/** Output that looks like the echo of one keystroke: 1-3 printable characters or a backspace echo. */
function looksTyped(data: string): boolean {
  const plain = plainText(data);
  if (PRINTABLE_SHORT.test(plain)) return true;
  return plain === "\b \b" || plain === "\b";
}

/**
 * Whether output that came right after a keystroke is its echo: no text after a line break (the
 * echo of Enter is only the break; text after it is program output or the next prompt).
 */
function looksEcho(data: string): boolean {
  const plain = plainText(data);
  const nl = plain.indexOf("\n");
  return nl < 0 || /^[\r\n]*$/.test(plain.slice(nl));
}

/** Without input events, keystrokes are inferred from short output events at human pace. */
function inferTyped(events: readonly CastEvent[], i: number, prevTyped: boolean): boolean {
  const ev = events[i] as CastEvent;
  const gap = i > 0 ? ev.t - (events[i - 1] as CastEvent).t : ev.t;
  if (ev.data === "\r\n") return prevTyped; // Enter right after typing
  return gap >= 20 && looksTyped(ev.data);
}

/**
 * Builds the playback timeline of a recording. Pure and deterministic.
 */
export function buildTimeline(rec: CastRecording, options: TimelineOptions = {}): Timeline {
  const idleLimit = Math.min(
    positive(options.idleLimit, DEFAULTS.idleLimit),
    rec.idleTimeLimit ?? Number.POSITIVE_INFINITY,
  );
  const startLimit = Math.min(positive(options.startLimit, DEFAULTS.startLimit), idleLimit);
  const maxDuration = positive(options.maxDuration, DEFAULTS.maxDuration);
  const speed = positive(options.speed, DEFAULTS.speed);
  const maxStep = positive(options.maxStep, DEFAULTS.maxStep);
  const maxStepEvents = Math.max(1, Math.floor(positive(options.maxStepEvents, DEFAULTS.maxStepEvents)));

  const source = rec.events.filter((e) => e.code === "o" || e.code === "i" || e.code === "r");
  const recordedInput = source.some((e) => e.code === "i");

  const gaps: number[] = [];
  const typed: boolean[] = [];
  let lastInput = Number.NEGATIVE_INFINITY;
  let prevTyped = false;
  for (let i = 0; i < source.length; i++) {
    const ev = source[i] as CastEvent;
    const raw = i === 0 ? ev.t : ev.t - (source[i - 1] as CastEvent).t;
    gaps.push(Math.min(raw, i === 0 ? startLimit : idleLimit) / speed);
    let isTyped: boolean;
    if (recordedInput) {
      // Echo of a keystroke arrives right after it and belongs to the same typing step. Once the
      // echo broke the line, what follows is output, however quickly it comes.
      if (ev.code === "i") lastInput = ev.t;
      isTyped =
        ev.code === "i" || (ev.code === "o" && ev.t - lastInput <= 150 && ev.data.length <= 16 && looksEcho(ev.data));
      if (isTyped && ev.code === "o" && ev.data.includes("\n")) lastInput = Number.NEGATIVE_INFINITY;
    } else {
      isTyped = ev.code === "o" && inferTyped(source, i, prevTyped);
    }
    typed.push(isTyped);
    prevTyped = isTyped;
  }

  const total = gaps.reduce((a, b) => a + b, 0);
  const scale = total > maxDuration ? maxDuration / total : 1;
  const events: PlayEvent[] = [];
  let t = 0;
  for (let i = 0; i < source.length; i++) {
    const ev = source[i] as CastEvent;
    t += (gaps[i] as number) * scale;
    events.push({ t, kind: ev.code as PlayKind, data: ev.data, typed: typed[i] as boolean });
  }

  return { events, steps: splitSteps(events, maxStep, maxStepEvents), duration: t, scale, recordedInput };
}

/**
 * Cuts the timeline where typing starts or stops, and wherever a step would exceed `maxStep` ms
 * or `maxStepEvents` events.
 */
export function splitSteps(events: readonly PlayEvent[], maxStep: number, maxStepEvents: number): Step[] {
  const steps: Step[] = [];
  let from = 0;
  let t0 = 0;
  let input = false;
  const close = (to: number): void => {
    if (to <= from) return;
    const t1 = (events[to - 1] as PlayEvent).t;
    steps.push({ from, to, t0, t1, input });
    from = to;
    t0 = t1;
  };
  for (let i = 0; i < events.length; i++) {
    const ev = events[i] as PlayEvent;
    if (i > from && (ev.typed !== input || ev.t - t0 > maxStep || i - from >= maxStepEvents)) close(i);
    if (i === from) input = ev.typed;
  }
  close(events.length);
  return steps;
}
