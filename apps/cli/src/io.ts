/** Output channels of one CLI invocation. Commands never touch process.stdout/stderr directly. */
export interface CliIo {
  /** Writes one line of program output to stdout. */
  out(line: string): void;
  /**
   * Writes one line of diagnostics (info, warnings, errors) to stderr. `run()` passes every line
   * through {@link printable} first, as they quote text from web pages and downloaded files.
   */
  err(line: string): void;
  /**
   * Interactive stderr for redrawn progress bars; absent when stderr is not a terminal,
   * in which case progress is reported as occasional plain lines through {@link CliIo.err}.
   */
  tty?: TerminalLike;
  /** Use ANSI colours in diagnostics. */
  color?: boolean;
}

/** The part of a TTY write stream the progress bar needs. */
export interface TerminalLike {
  write(chunk: string): void;
  readonly columns: number;
}

const ANSI = { red: 31, green: 32, yellow: 33, dim: 2, bold: 1 } as const;
/** The sequences {@link paint} writes (styles and the reset): the only ones {@link printable} may keep. */
const STYLES = new Set([0, ...Object.values(ANSI)].map((code) => `\u001b[${code}m`));
/** A control character other than newline and tab, with what follows it when that may end a style sequence. */
const CONTROL = /[^\P{Cc}\n\t](?:\[\d{1,2}m)?/gu;

/**
 * Makes text safe to print on a terminal: control characters (C0, DEL, C1) other than newline and tab
 * become visible `\xHH` escapes, so a web page or a downloaded file quoted in a message cannot send
 * terminal sequences such as OSC 52 (overwrite the clipboard) or OSC 0 (set the window title).
 * @param keepStyles Keep the colour codes of {@link paint} (they only change colour and weight).
 */
export function printable(text: string, keepStyles = false): string {
  return text.replace(CONTROL, (match) =>
    keepStyles && STYLES.has(match)
      ? match
      : `\\x${match.charCodeAt(0).toString(16).padStart(2, "0")}${match.slice(1)}`,
  );
}

/**
 * `io` with every stderr line passed through {@link printable}, keeping colour codes only when colour
 * is on; stdout carries data and is left as is.
 */
export function printableIo(io: CliIo): CliIo {
  return { ...io, err: (line) => io.err(printable(line, io.color === true)) };
}

/** Wraps `text` in an ANSI style when colour output is enabled. */
export function paint(io: CliIo, style: keyof typeof ANSI, text: string): string {
  return io.color ? `\u001b[${ANSI[style]}m${text}\u001b[0m` : text;
}

/** Prints a warning line on stderr. */
export function warn(io: CliIo, message: string): void {
  io.err(`${paint(io, "yellow", "warning:")} ${message}`);
}

/**
 * Creates the IO for the real process. Colour follows NO_COLOR / FORCE_COLOR and whether stderr is a TTY.
 */
export function processIo(env: NodeJS.ProcessEnv = process.env): CliIo {
  const stderrTty = process.stderr.isTTY === true;
  const color = env.NO_COLOR === undefined && (env.FORCE_COLOR !== undefined ? env.FORCE_COLOR !== "0" : stderrTty);
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    tty: stderrTty
      ? {
          write: (chunk) => process.stderr.write(chunk),
          get columns() {
            return process.stderr.columns || 80;
          },
        }
      : undefined,
    color,
  };
}
