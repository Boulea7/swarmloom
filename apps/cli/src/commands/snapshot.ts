import { randomBytes } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { expectPositionals, parseCommand, readInt } from "../args";
import { locateAssets, requireSnapshotBundle } from "../assets";
import { launchBrowser, newContext, watchPage } from "../browser/launch";
import { applyNetworkPolicy } from "../browser/network";
import { snapshotPage } from "../browser/snapshot";
import { findBrowser } from "../discovery/browser";
import { systemHost } from "../discovery/host";
import { installedPlaywright } from "../discovery/playwright";
import { UsageError } from "../errors";
import { warn } from "../io";
import { inputBase, isSiblingAsset, isWebUrl } from "../pipeline/input";
import { type StaticServer, startStaticServer } from "../server/static";
import { Cleanup } from "../util/async";
import type { Command, CommandContext } from "./types";

const HELP = `Usage: swarmloom snapshot <url|file.html> [options]

Capture a web page as a SwarmLoom Blueprint (JSON) that the player, <swarm-loom> and Studio can replay.
Local HTML files open with their scripts turned off. The images, fonts, style sheets and media next to
them load; other files in that folder are not served, and only https images and fonts load from other sites.

  -o, --output <file>   Output file, or - for stdout. Default: blueprint.json
      --width <px>      Viewport width in CSS px (16-7680). Default: 1280
      --height <px>     Viewport height in CSS px (16-7680). Default: 720
      --chrome <path>   Chrome/Chromium/Edge/Brave executable. Default: SWARMLOOM_CHROME, then auto-detect
      --require-sandbox
                        Fail when the browser's sandbox does not start (as root, or with user
                        namespaces turned off) instead of running the browser without it
  -q, --quiet           Errors only. The warning that the browser runs without its sandbox still shows
      --verbose         Echo the page's console and blocked requests to stderr
  -h, --help            Show this help

Examples:
  swarmloom snapshot https://example.com -o example.json
  swarmloom snapshot examples/html/landing.html --width 1440 -o - > page.json`;

const OPTIONS = {
  output: { type: "string", short: "o" },
  width: { type: "string" },
  height: { type: "string" },
  chrome: { type: "string" },
  "require-sandbox": { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);
const PAGE_TIMEOUT_MS = 60_000;

/**
 * Sent with every file of a local page. Its own scripts never run, so it cannot read what is published
 * next to it; the snapshot script is evaluated over DevTools, which the page's CSP does not limit.
 */
const LOCAL_PAGE_HEADERS = { "Content-Security-Policy": "script-src 'none'; object-src 'none'" };

export interface SnapshotOptions {
  input: string;
  /** Absolute path, or "-" for stdout. */
  output: string;
  width: number;
  height: number;
  chrome?: string;
  requireSandbox: boolean;
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
    requireSandbox: values["require-sandbox"] ?? false,
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

/**
 * Publishes a local HTML file on a loopback server the way render publishes its input: the file itself
 * plus the images, fonts, style sheets and media next to it (no dotfiles, documents or scripts), under
 * a random path other local processes cannot guess.
 * @returns The server and the page URL.
 */
async function serveLocalPage(file: string): Promise<{ server: StaticServer; url: string }> {
  const base = inputBase(randomBytes(12).toString("base64url"));
  const page = base + encodeURIComponent(path.basename(file));
  const server = await startStaticServer({
    files: new Map([[page, file]]),
    mounts: [{ prefix: base, dir: path.dirname(file), accept: isSiblingAsset }],
    headers: LOCAL_PAGE_HEADERS,
  });
  return { server, url: new URL(page, server.url).href };
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
      const local = await serveLocalPage(file);
      cleanup.defer(() => local.server.close());
      url = local.url;
    }
    const browser = await launchBrowser(browserPath, {
      // Local pages open with their scripts off (LOCAL_PAGE_HEADERS).
      webPages: !file,
      requireSandbox: opts.requireSandbox,
      // A security downgrade, so it shows under --quiet too.
      onUnsandboxed: (message) => warn(io, message),
    });
    cleanup.defer(() => browser.close());
    const context = await newContext(browser, {
      width: opts.width,
      height: opts.height,
      scale: 1,
      colorScheme: "light",
      locale: "en-US",
      // Web pages: inject regardless of their CSP. Local pages keep the script block they are served with.
      bypassCSP: !file,
    });
    let blockedRequests = 0;
    if (file) {
      // Decision C03: the loopback server plus https images and fonts; nothing else leaves the machine.
      await applyNetworkPolicy(context, { localOrigin: new URL(url).origin, remoteAssets: true }, (blocked, type) => {
        blockedRequests += 1;
        if (opts.verbose) io.err(`[network] blocked ${type} ${blocked}`);
      });
    }
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
      if (blockedRequests > 0 && !opts.verbose) {
        warn(io, `blocked ${blockedRequests} request(s) the page made to other sites (see --verbose)`);
      }
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
