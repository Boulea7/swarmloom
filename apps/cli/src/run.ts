import pkg from "../package.json" with { type: "json" };
import { doctorCommand } from "./commands/doctor";
import { formatsCommand } from "./commands/formats";
import { renderCommand } from "./commands/render";
import { serveCommand } from "./commands/serve";
import { snapshotCommand } from "./commands/snapshot";
import type { Command, CommandContext } from "./commands/types";
import { briefMessage, CliError, ExitCode } from "./errors";
import { type CliIo, paint } from "./io";

export type { CommandContext } from "./commands/types";
export type { CliIo } from "./io";

const COMMANDS: readonly Command[] = [renderCommand, snapshotCommand, serveCommand, formatsCommand, doctorCommand];

/** Commands whose unexpected failures count as render failures (exit 3) rather than usage errors. */
const RENDERING = new Set(["render", "snapshot"]);

const USAGE = `SwarmLoom ${pkg.version}: a swarm of cursors builds your files and pages, and you get the video.

Usage: swarmloom <command> [options]

Commands:
${COMMANDS.map((c) => `  ${c.summary}`).join("\n")}

Options:
  -h, --help            Show help (swarmloom <command> --help for a command)
  -v, --version         Show the version

Exit codes: 0 ok, 1 usage error, 2 missing dependency, 3 render failure, 130 interrupted.`;

/** Run options; everything except `io` defaults to the current process. */
export type RunOptions = Partial<Omit<CommandContext, "io">> & { io: CliIo };

/**
 * Runs the CLI with `argv` (without the node and script paths).
 * Never throws: failures are printed to stderr and turned into the exit code.
 *
 * @returns 0 ok, 1 usage error, 2 missing dependency, 3 render failure, 130 interrupted.
 */
export async function run(argv: string[], options: RunOptions): Promise<number> {
  const ctx: CommandContext = { env: process.env, cwd: process.cwd(), ...options };
  const { io } = ctx;
  const [first, ...rest] = argv;

  if (first === undefined) {
    io.err(USAGE);
    return ExitCode.Usage;
  }
  if (first === "-h" || first === "--help") {
    io.out(USAGE);
    return ExitCode.Ok;
  }
  if (first === "-v" || first === "--version") {
    io.out(pkg.version);
    return ExitCode.Ok;
  }
  if (first === "help") {
    const topic = rest[0] ? COMMANDS.find((c) => c.name === rest[0]) : undefined;
    io.out(topic ? topic.help : USAGE);
    return topic || !rest[0] ? ExitCode.Ok : ExitCode.Usage;
  }
  const command = COMMANDS.find((c) => c.name === first);
  if (!command) {
    const what = first.startsWith("-") ? `Unknown option ${first}` : `Unknown command "${first}"`;
    io.err(`${paint(io, "red", "error:")} ${what}\n\n${USAGE}`);
    return ExitCode.Usage;
  }

  try {
    return await command.run(rest, ctx);
  } catch (error) {
    if (error instanceof CliError) {
      if (error.exitCode !== ExitCode.Interrupted) {
        io.err(`${paint(io, "red", "error:")} ${error.message}`);
        if (error.hint) io.err(error.hint);
      }
      return error.exitCode;
    }
    io.err(`${paint(io, "red", "error:")} ${briefMessage(error)}`);
    if (ctx.env.SWARMLOOM_DEBUG && error instanceof Error && error.stack) io.err(error.stack);
    return RENDERING.has(command.name) ? ExitCode.RenderFailed : ExitCode.Usage;
  }
}
