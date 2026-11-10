/**
 * ANSI-coloured logs (program output, tracebacks) to plain text or styled HTML, without a
 * fixed screen: lines grow without limit, CR returns to the line start and later text
 * overwrites (progress bars), BS steps back, `ESC [ K` erases. Other sequences are dropped.
 */

import { LOOM_INK, type TerminalTheme } from "./palette";
import { type AnsiHandler, AnsiParser } from "./parser";
import { type Attrs, applySgr, attrsCss, PLAIN, parseParams } from "./sgr";

/** A styled piece of one log line. */
export interface LogRun {
  text: string;
  attrs: Attrs;
}

interface LogCell {
  ch: string;
  a: Attrs;
}

/** Hard limits that keep hostile output from exhausting memory. */
const MAX_LINE = 4096;
const MAX_LINES = 100_000;

class LogBuilder implements AnsiHandler {
  readonly lines: LogCell[][] = [[]];
  #col = 0;
  #attrs: Attrs = PLAIN;

  get #line(): LogCell[] {
    return this.lines[this.lines.length - 1] as LogCell[];
  }

  print(text: string): void {
    const line = this.#line;
    for (const ch of text) {
      if (this.#col >= MAX_LINE) break;
      const cell = { ch, a: this.#attrs };
      if (this.#col < line.length) line[this.#col] = cell;
      else {
        while (line.length < this.#col) line.push({ ch: " ", a: PLAIN });
        line.push(cell);
      }
      this.#col++;
    }
  }

  control(code: number): void {
    if (code === 0x0a) {
      if (this.lines.length < MAX_LINES) this.lines.push([]);
      else this.#line.length = 0;
      this.#col = 0;
    } else if (code === 0x0d) this.#col = 0;
    else if (code === 0x08) this.#col = Math.max(0, this.#col - 1);
    else if (code === 0x09) this.print(" ".repeat(8 - (this.#col % 8)));
  }

  csi(priv: string, params: string, inter: string, final: string): void {
    if (priv !== "" || inter !== "") return;
    if (final === "m") this.#attrs = applySgr(this.#attrs, params);
    else if (final === "K") {
      const mode = parseParams(params)[0]?.[0] ?? 0;
      const line = this.#line;
      if (mode <= 0) line.length = Math.min(line.length, this.#col);
      else if (mode === 1) for (let i = 0; i <= this.#col && i < line.length; i++) line[i] = { ch: " ", a: PLAIN };
      else if (mode === 2) line.length = 0;
    } else if (final === "G") {
      this.#col = Math.max(0, (parseParams(params)[0]?.[0] ?? 1) - 1);
    }
  }

  esc(): void {}

  osc(): void {}
}

/** Parses `text` into lines of styled runs. Trailing CR/LF produce an empty last line. */
export function ansiToRuns(text: string): LogRun[][] {
  const builder = new LogBuilder();
  new AnsiParser().feed(text, builder);
  return builder.lines.map((line) => {
    const runs: LogRun[] = [];
    for (const cell of line) {
      const last = runs[runs.length - 1];
      if (last && last.attrs === cell.a) last.text += cell.ch;
      else runs.push({ text: cell.ch, attrs: cell.a });
    }
    return runs;
  });
}

/** Text with every escape sequence removed and CR/BS overwrites applied. */
export function stripAnsi(text: string): string {
  return ansiToRuns(text)
    .map((runs) => runs.map((r) => r.text).join(""))
    .join("\n");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for use in HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/**
 * ANSI text to HTML: escaped text with `<span style>` runs for colours and attributes, lines
 * joined with `\n` (put the result in a `white-space: pre` container painted with `theme.fg`).
 */
export function ansiToHtml(text: string, theme: TerminalTheme = LOOM_INK): string {
  return ansiToRuns(text)
    .map((runs) =>
      runs
        .map((r) => {
          const css = attrsCss(r.attrs, theme);
          const body = escapeHtml(r.text);
          return css ? `<span style="${css}">${body}</span>` : body;
        })
        .join(""),
    )
    .join("\n");
}
