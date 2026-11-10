import { performance } from "node:perf_hooks";
import type { CliIo } from "../io";

const REDRAW_MS = 100;
const BAR_WIDTH = 24;

/** Formats seconds as m:ss (or h:mm:ss). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
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
    if (this.io.tty) this.draw(label);
    else this.io.err(label);
  }

  /** Removes the bar so following lines start clean. */
  clear(): void {
    if (this.io.tty && this.drawn) this.io.tty.write("\r\u001b[2K");
    this.drawn = false;
  }

  private draw(text: string): void {
    const tty = this.io.tty;
    if (!tty) return;
    const width = Math.max(20, tty.columns - 1);
    tty.write(`\r\u001b[2K${text.length > width ? text.slice(0, width) : text}`);
    this.drawn = true;
  }

  private line(ratio: number, frames: number, u: ProgressUpdate, now: number): string {
    const filled = Math.round(ratio * BAR_WIDTH);
    const bar = `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
    const elapsed = (now - this.started) / 1000;
    const perFrame = elapsed / frames;
    const remaining = Math.max(0, this.estimatedFrames - frames);
    const eta = u.done ? "done" : frames >= 5 ? `${formatClock(perFrame * remaining)} left` : "estimating";
    const layers = u.total > 0 ? `  layers ${u.built}/${u.total}` : "";
    return `rendering ${bar} ${String(Math.round(ratio * 100)).padStart(3)}%  frame ${frames}  ${eta}${layers}`;
  }
}
