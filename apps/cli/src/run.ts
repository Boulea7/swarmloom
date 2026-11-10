import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const COMMANDS: Record<string, string> = {
  render: "render <file|url> -o out.mp4   Render a build to MP4/WebM/GIF/WebP with sound",
  snapshot: "snapshot <url> -o bp.json       Capture a page as a Blueprint",
  serve: "serve                           Open Studio locally",
  formats: "formats                         List supported input formats",
};

const USAGE = [
  "Usage: swarmloom <command> [options]",
  "",
  "Commands:",
  ...Object.values(COMMANDS).map((line) => `  ${line}`),
  "",
  "Options:",
  "  -h, --help     Show help",
  "  -v, --version  Show version",
].join("\n");

/**
 * Runs the CLI with `argv` (without the node and script paths) and returns the exit code.
 * Exit codes: 0 ok, 1 command failed or not implemented, 2 usage error.
 */
export function run(argv: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
    strict: false,
  });
  const [command] = positionals;

  if (values.version) {
    io.out(pkg.version);
    return 0;
  }
  if (!command) {
    io.out(USAGE);
    return values.help ? 0 : 2;
  }
  const usage = COMMANDS[command];
  if (!usage) {
    io.err(`Unknown command "${command}".\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    io.out(`Usage: swarmloom ${usage}`);
    return 0;
  }
  io.err(`swarmloom ${command}: not implemented yet`);
  return 1;
}
