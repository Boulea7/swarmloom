import { performance } from "node:perf_hooks";
import type { CliIo } from "../io";

const REDRAW_MS = 100;
const BAR_WIDTH = 24;
/** A bar narrower than this says nothing the percent does not, so it is left out. */
const MIN_BAR = 4;
const LABEL = "rendering";

/** Formats seconds as m:ss (or h:mm:ss). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Joins `fields` with two spaces and leaves out the trailing fields that do not fit in `width`
 * columns, so a narrow terminal never shows half a word. Only a first field wider than `width` is cut.
 */
export function fitFields(fields: readonly string[], width: number): string {
  let line = fields[0] ?? "";
  if (line.length > width) return line.slice(0, width);
  for (let i = 1; i < fields.length; i++) {
    const next = `${line}  ${fields[i]}`;
    if (next.length > width) break;
    line = next;
  }
  return line;
}

/**
 * Lays out the redrawn progress line in `width` columns. The percent comes first, then the time left;
 * the bar takes the room that remains (up to {@link BAR_WIDTH} cells) and the `extras` (frame, layers)
 * follow while they fit whole. Below the label's width only the percent is kept.
 */
function progressLine(ratio: number, eta: string, extras: readonly string[], width: number): string {
  const percent = `${String(Math.round(ratio * 100)).padStart(3)}%`;
  const labelled = `${LABEL} ${percent}`;
  if (labelled.length > width) return fitFields([percent.trimStart(), eta], width);
  const numbers = fitFields([labelled, eta], width);
  const cells = Math.min(BAR_WIDTH, width - numbers.length - 1);
  if (cells < MIN_BAR) return numbers;
  const filled = Math.round(ratio * cells);
  const bar = `${"█".repeat(filled)}${"░".repeat(cells - filled)}`;
  return fitFields([`${LABEL} ${bar} ${numbers.slice(LABEL.length + 1)}`, ...extras], width);
}

export interface ProgressUpdate {
  frame: number;
  built: number;
  total: number;
  done: boolean;
}

/**
 * Render progress on stderr: a redrawn bar with ETA on terminals, a line per quarter otherwise,
 * nothing when quiet. The total is an estimate, so the bar never claims 100% before the page is done.
 * Wall-clock time here only drives the ETA display, never the render itself.
 */
export class Progress {
  private readonly started = performance.now();
  private lastDraw = -Infinity;
  private lastQuarter = 0;
  private drawn = false;

  constructor(
    private readonly io: CliIo,
    private estimatedFrames: number,
    private readonly quiet: boolean,
  ) {}

  /** Sets the estimated total number of frames once the page reported the build length. */
  expect(frames: number): void {
    this.estimatedFrames = Math.max(1, frames);
  }

  /** Records one captured frame. */
  update(u: ProgressUpdate): void {
    if (this.quiet) return;
    const frames = u.frame + 1;
    if (frames > this.estimatedFrames) this.estimatedFrames = frames + 1;
    const ratio = u.done ? 1 : Math.min(0.99, frames / this.estimatedFrames);
    if (this.io.tty) {
      const now = performance.now();
      if (!u.done && now - this.lastDraw < REDRAW_MS) return;
      this.lastDraw = now;
      this.draw(this.line(ratio, frames, u, now));
    } else {
      const quarter = Math.floor(ratio * 4);
      if (quarter > this.lastQuarter && quarter < 4) {
        this.lastQuarter = quarter;
        this.io.err(`rendering ${quarter * 25}% (frame ${frames}/~${this.estimatedFrames})`);
      }
    }
  }

  /** Shows a phase after the frame loop ("encoding", "muxing audio"). */
  phase(label: string): void {
    if (this.quiet) return;
    if (this.io.tty) this.draw(fitFields([label], this.columns()));
    else this.io.err(label);
  }

  /** Removes the bar so following lines start clean. */
  clear(): void {
    if (this.io.tty && this.drawn) this.io.tty.write("\r\u001b[2K");
    this.drawn = false;
  }

  /** Columns a redrawn line may use: one less than the terminal's, so it never wraps. */
  private columns(): number {
    return Math.max(0, (this.io.tty?.columns ?? 80) - 1);
  }

  private draw(text: string): void {
    const tty = this.io.tty;
    if (!tty) return;
    tty.write(`\r\u001b[2K${text}`);
    this.drawn = true;
  }

  private line(ratio: number, frames: number, u: ProgressUpdate, now: number): string {
    const elapsed = (now - this.started) / 1000;
    const perFrame = elapsed / frames;
    const remaining = Math.max(0, this.estimatedFrames - frames);
    const eta = u.done ? "done" : frames >= 5 ? `${formatClock(perFrame * remaining)} left` : "estimating";
    const extras = [`frame ${frames}`];
    if (u.total > 0) extras.push(`layers ${u.built}/${u.total}`);
    return progressLine(ratio, eta, extras, this.columns());
  }
}
