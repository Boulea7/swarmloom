import type { AssetPaths } from "../assets";
import type { HostEnv } from "../discovery/host";
import type { CliIo } from "../io";

/** Everything a command may touch besides its arguments; tests replace any of it. */
export interface CommandContext {
  io: CliIo;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** Aborted on Ctrl+C / SIGTERM. */
  signal?: AbortSignal;
  /** Program discovery environment. Default: the real machine. */
  host?: HostEnv;
  /** Bundled asset locations. Default: located next to the CLI (see assets.ts). */
  assets?: AssetPaths;
  /** Parent directory for render work files. Default: the output's directory. */
  tmpRoot?: string;
}

export interface Command {
  name: string;
  /** One line for the command list. */
  summary: string;
  /** Full `--help` text. */
  help: string;
  /** Runs the command; resolves with the exit code or throws a CliError. */
  run(argv: string[], ctx: CommandContext): Promise<number>;
}
