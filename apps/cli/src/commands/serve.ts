import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expectPositionals, parseCommand, readInt } from "../args";
import { locateAssets, requireStudioDir } from "../assets";
import { UsageError } from "../errors";
import { type CliIo, warn } from "../io";
import { startStaticServer } from "../server/static";
import { whenAborted } from "../util/async";
import type { Command, CommandContext } from "./types";

const HELP = `Usage: swarmloom serve [options]

Serve the bundled SwarmLoom Studio on this machine. Stop it with Ctrl+C.

      --port <n>      Port (0 picks a free one). Default: 0
      --host <addr>   Interface to bind. Default: 127.0.0.1 (this machine only)
      --open          Open Studio in the default browser
  -h, --help          Show this help`;

const OPTIONS = {
  port: { type: "string" },
  host: { type: "string" },
  open: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * URL path Studio was built for (Vite `base`), read from the asset URLs in its index.html.
 * Pages builds use "/swarmloom/studio/", local builds "/"; serving under the same base keeps
 * absolute asset URLs and the service worker scope valid.
 */
export function detectBase(indexHtml: string): string {
  const match = /(?:src|href)="(\/[^"]*?)assets\//.exec(indexHtml);
  return match?.[1] ?? "/";
}

function openInBrowser(url: string, io: CliIo): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args as string[], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => warn(io, `could not open a browser; visit ${url}`));
  child.unref();
}

async function run(argv: string[], ctx: CommandContext): Promise<number> {
  const { io } = ctx;
  const { values, positionals } = parseCommand("serve", argv, OPTIONS);
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  expectPositionals("serve", positionals, []);
  const port = readInt("port", values.port, 0, 0, 65535);
  const host = values.host ?? "127.0.0.1";
  const root = requireStudioDir(ctx.assets ?? locateAssets(ctx.env));
  const base = detectBase(await readFile(path.join(root, "index.html"), "utf8"));

  let server: Awaited<ReturnType<typeof startStaticServer>>;
  try {
    server = await startStaticServer({ root, host, port, base, fallback: "index.html" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") throw new UsageError(`Port ${port} is already in use`, "Pick another --port or use 0.");
    if (code === "EACCES") throw new UsageError(`No permission to listen on port ${port}`, "Use a port above 1024.");
    if (code === "EADDRNOTAVAIL" || code === "ENOTFOUND") throw new UsageError(`Cannot listen on ${host}`);
    throw error;
  }
  io.out(`SwarmLoom Studio: ${server.url}`);
  if (!LOOPBACK.has(host)) warn(io, `listening on ${host}: other machines on your network can open Studio`);
  io.err("Press Ctrl+C to stop.");
  if (values.open) openInBrowser(server.url, io);
  if (ctx.signal) await whenAborted(ctx.signal);
  await server.close();
  return 0;
}

export const serveCommand: Command = {
  name: "serve",
  summary: "serve                 Serve Studio locally",
  help: HELP,
  run,
};
