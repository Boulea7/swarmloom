import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { expectPositionals, parseCommand, readInt } from "../args";
import { locateAssets, requireSnapshotBundle } from "../assets";
import { launchBrowser, newContext, watchPage } from "../browser/launch";
import { snapshotPage } from "../browser/snapshot";
import { findBrowser } from "../discovery/browser";
import { systemHost } from "../discovery/host";
import { installedPlaywright } from "../discovery/playwright";
import { UsageError } from "../errors";
import { warn } from "../io";
import { isWebUrl } from "../pipeline/input";
import { startStaticServer } from "../server/static";
import { Cleanup } from "../util/async";
import type { Command, CommandContext } from "./types";

const HELP = `Usage: swarmloom snapshot <url|file.html> [options]

Capture a web page as a SwarmLoom Blueprint (JSON) that the player, <swarm-loom> and Studio can replay.
Local HTML files are served from their own folder so relative images and styles load.

  -o, --output <file>   Output file, or - for stdout. Default: blueprint.json
      --width <px>      Viewport width in CSS px (16-7680). Default: 1280
      --height <px>     Viewport height in CSS px (16-7680). Default: 720
      --chrome <path>   Chrome/Chromium/Edge/Brave executable. Default: SWARMLOOM_CHROME, then auto-detect
  -q, --quiet           Errors only
      --verbose         Echo the page's console to stderr
  -h, --help            Show this help

Examples:
  swarmloom snapshot https://example.com -o example.json
  swarmloom snapshot docs/index.html --width 1440 -o - > page.json`;

const OPTIONS = {
  output: { type: "string", short: "o" },
  width: { type: "string" },
  height: { type: "string" },
  chrome: { type: "string" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);
const PAGE_TIMEOUT_MS = 60_000;

export interface SnapshotOptions {
  input: string;
  /** Absolute path, or "-" for stdout. */
  output: string;
  width: number;
  height: number;
  chrome?: string;
  quiet: boolean;
  verbose: boolean;
}

/**
 * Parses `snapshot` arguments.
 * @returns The options, or "help".
 * @throws UsageError for invalid arguments.
 */
export function parseSnapshotOptions(argv: string[], cwd: string): SnapshotOptions | "help" {
  const { values, positionals } = parseCommand("snapshot", argv, OPTIONS);
  if (values.help) return "help";
  const [input] = expectPositionals("snapshot", positionals, ["<url|file.html>"]) as [string];
  const output = values.output ?? "blueprint.json";
  return {
    input,
    output: output === "-" ? "-" : path.resolve(cwd, output),
    width: readInt("width", values.width, 1280, 16, 7680),
    height: readInt("height", values.height, 720, 16, 7680),
    chrome: values.chrome,
    quiet: values.quiet ?? false,
    verbose: values.verbose ?? false,
  };
}

/** Local HTML file to snapshot, or null for web URLs. @throws UsageError for anything else. */
async function localHtmlFile(input: string, cwd: string): Promise<string | null> {
  if (isWebUrl(input)) return null;
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(input) && !/^file:/i.test(input)) {
    throw new UsageError(`Unsupported URL scheme in ${input}`, "Use an http(s) URL or a local .html file.");
  }
  const file = /^file:/i.test(input) ? fileURLToPath(input) : path.resolve(cwd, input);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new UsageError(`Input not found: ${file}`);
  if (!HTML_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    throw new UsageError(
      `snapshot captures web pages; ${path.basename(file)} is not an HTML file`,
      "Use swarmloom render for documents, images and other formats.",
    );
  }
  return file;
}

async function run(argv: string[], ctx: CommandContext): Promise<number> {
  const { io } = ctx;
  const opts = parseSnapshotOptions(argv, ctx.cwd);
  if (opts === "help") {
    io.out(HELP);
    return 0;
  }
  const file = await localHtmlFile(opts.input, ctx.cwd);
  const assets = ctx.assets ?? locateAssets(ctx.env);
  const bundle = await readFile(requireSnapshotBundle(assets), "utf8");
  const host = ctx.host ?? systemHost(ctx.env);
  const browserPath = findBrowser(host, { flag: opts.chrome, playwright: installedPlaywright() }).path;

  const cleanup = new Cleanup((message) => warn(io, `cleanup: ${message}`));
  try {
    let url = opts.input;
    if (file) {
      const server = await startStaticServer({ root: path.dirname(file) });
      cleanup.defer(() => server.close());
      url = server.url + encodeURIComponent(path.basename(file));
    }
    const browser = await launchBrowser(browserPath);
    cleanup.defer(() => browser.close());
    const context = await newContext(browser, {
      width: opts.width,
      height: opts.height,
      scale: 1,
      colorScheme: "light",
      locale: "en-US",
      bypassCSP: true,
    });
    const watch = (page: Page) => watchPage(page, opts.quiet ? { ...io, err: () => {} } : io, opts.verbose);
    const { blueprint, status } = await snapshotPage(context, {
      url,
      bundle,
      timeoutMs: PAGE_TIMEOUT_MS,
      signal: ctx.signal,
      watch,
      source: file ? { name: path.basename(file) } : undefined,
    });
    const json = JSON.stringify(blueprint);
    if (opts.output === "-") io.out(json);
    else await writeFile(opts.output, `${json}\n`);
    if (!opts.quiet) {
      if (status >= 400) warn(io, `the page answered HTTP ${status}; the snapshot shows that response`);
      if (blueprint.truncated) {
        warn(io, `content was dropped (${blueprint.truncated.dropped} layers): ${blueprint.truncated.reason}`);
      }
      const where = opts.output === "-" ? "stdout" : path.relative(ctx.cwd, opts.output) || opts.output;
      io.err(`Wrote ${where}: ${blueprint.layers.length} layers, ${blueprint.size.w}x${blueprint.size.h} px`);
    }
    return 0;
  } finally {
    await cleanup.run();
  }
}

export const snapshotCommand: Command = {
  name: "snapshot",
  summary: "snapshot <url|file>   Capture a web page as Blueprint JSON",
  help: HELP,
  run,
};
