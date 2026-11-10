import { type FormatEntry, formats } from "@swarmloom/formats";
import { expectPositionals, parseCommand } from "../args";
import type { Command, CommandContext } from "./types";

const HELP = `Usage: swarmloom formats [--json]

List the input formats SwarmLoom can build. Any http(s) URL of a web page works too.

      --json   Print the list as JSON (id, label, extensions, mime)
  -h, --help   Show this help`;

const OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/** Lays rows out as left-aligned columns separated by two spaces. */
export function table(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
}

/** Formats that take files (the live-DOM adapter is reached through URLs instead). */
function fileFormats(list: readonly FormatEntry[]): FormatEntry[] {
  return list.filter((f) => f.extensions.length > 0);
}

async function run(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parseCommand("formats", argv, OPTIONS);
  if (values.help) {
    ctx.io.out(HELP);
    return 0;
  }
  expectPositionals("formats", positionals, []);
  const list = fileFormats(formats);
  if (values.json) {
    const rows = list.map(({ id, label, extensions, mime }) => ({ id, label, extensions, mime }));
    ctx.io.out(JSON.stringify(rows, null, 2));
    return 0;
  }
  const rows = [
    ["FORMAT", "ID", "EXTENSIONS"],
    ...list.map((f) => [f.label, f.id, f.extensions.map((e) => `.${e}`).join(" ")]),
    ["Web page", "dom", "any http(s) URL"],
  ];
  for (const line of table(rows)) ctx.io.out(line);
  return 0;
}

export const formatsCommand: Command = {
  name: "formats",
  summary: "formats               List supported input formats",
  help: HELP,
  run,
};
