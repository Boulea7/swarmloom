/**
 * Process exit codes of the `swarmloom` command. They are part of the public CLI contract:
 * scripts and CI jobs branch on them.
 */
export const ExitCode = {
  Ok: 0,
  /** Bad arguments or an input the CLI cannot handle. */
  Usage: 1,
  /** Chrome/Chromium, ffmpeg or a bundled asset could not be found or is unusable. */
  MissingDependency: 2,
  /** The browser, the render page or ffmpeg failed while producing the output. */
  RenderFailed: 3,
  /** Stopped by Ctrl+C or SIGTERM (128 + SIGINT, the shell convention). */
  Interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An error the CLI reports to the user without a stack trace. */
export class CliError extends Error {
  /**
   * @param message One-line description of what went wrong.
   * @param exitCode Process exit code to use.
   * @param hint Optional next step for the user ("Install ffmpeg: ...").
   */
  constructor(
    message: string,
    readonly exitCode: ExitCodeValue,
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid command line or unsupported input (exit 1). */
export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.Usage, hint);
  }
}

/** A required program or bundled asset is missing (exit 2). */
export class MissingDependencyError extends CliError {
  constructor(message: string, hint?: string, options?: ErrorOptions) {
    super(message, ExitCode.MissingDependency, hint, options);
  }
}

/** The render pipeline failed (exit 3). */
export class RenderError extends CliError {
  constructor(message: string, hint?: string, options?: ErrorOptions) {
    super(message, ExitCode.RenderFailed, hint, options);
  }
}

/** The user interrupted the command (exit 130). */
export class InterruptedError extends CliError {
  constructor() {
    super("Interrupted", ExitCode.Interrupted);
  }
}

/** Throws {@link InterruptedError} when `signal` has been aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new InterruptedError();
}

/** Message of any thrown value, for logs. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * First line of an error message without Playwright's call prefixes
 * ("page.evaluate: Error: boom" becomes "boom").
 */
export function briefMessage(error: unknown): string {
  const first = errorMessage(error).split("\n")[0] ?? "";
  return first.replace(/^(?:[\w.]+: )+/, "") || first;
}
