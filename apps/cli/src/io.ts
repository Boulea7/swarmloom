/** Output channels of one CLI invocation. Commands never touch process.stdout/stderr directly. */
export interface CliIo {
  /** Writes one line of program output to stdout. */
  out(line: string): void;
  /** Writes one line of diagnostics (info, warnings, errors) to stderr. */
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
