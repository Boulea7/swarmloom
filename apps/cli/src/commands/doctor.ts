import { expectPositionals, parseCommand } from "../args";
import { locateAssets } from "../assets";
import { launchBrowser, playwrightChromiumPath } from "../browser/launch";
import { findBrowser } from "../discovery/browser";
import { type FfmpegCaps, findFfmpeg, formatFfmpegVersion, probeFfmpeg, systemFfmpegDeps } from "../discovery/ffmpeg";
import { type HostEnv, systemHost } from "../discovery/host";
import { CliError, ExitCode, errorMessage } from "../errors";
import { type CliIo, paint } from "../io";
import { type OutputFormat, planMux, planVideo } from "../pipeline/encode";
import { guard } from "../util/async";
import type { Command, CommandContext } from "./types";

const HELP = `Usage: swarmloom doctor [options]

Check that a Chromium-based browser and ffmpeg are found and work, list which video formats
this machine can export, and print how to fix anything missing.

      --chrome <path>   Browser executable to check instead of the auto-detected one
      --ffmpeg <path>   ffmpeg executable to check instead of the auto-detected one
  -h, --help            Show this help

Exits with 0 when render can work, 2 when something it needs is missing.`;

const OPTIONS = {
  chrome: { type: "string" },
  ffmpeg: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

const MIN_NODE_MAJOR = 20;
const PROBE_MUX = { video: "v", wav: "a", output: "o", durationMs: 1000 };

type Status = "ok" | "fail" | "warn";

function report(io: CliIo, status: Status, label: string, detail: string, fix?: string): void {
  const mark =
    status === "ok" ? paint(io, "green", "✓") : status === "warn" ? paint(io, "yellow", "!") : paint(io, "red", "✗");
  io.out(`${mark} ${label.padEnd(16)} ${detail}`);
  if (fix) for (const line of fix.split("\n")) io.out(`  ${" ".repeat(16)} ${paint(io, "dim", line)}`);
}

async function checkBrowser(io: CliIo, host: HostEnv, flag: string | undefined): Promise<boolean> {
  let found: ReturnType<typeof findBrowser>;
  try {
    const playwrightPath = await playwrightChromiumPath();
    found = findBrowser(host, { flag, playwrightPath: () => playwrightPath });
  } catch (error) {
    report(io, "fail", "Browser", errorMessage(error), error instanceof CliError ? error.hint : undefined);
    return false;
  }
  try {
    const browser = await guard(launchBrowser(found.path), "Starting the browser", 70_000);
    const version = browser.version();
    await browser.close();
    report(io, "ok", "Browser", `${version} at ${found.path} (from ${found.source})`);
    return true;
  } catch (error) {
    report(io, "fail", "Browser", errorMessage(error), error instanceof CliError ? error.hint : undefined);
    return false;
  }
}

const FORMAT_LABELS: Record<Exclude<OutputFormat, "png-seq">, string> = {
  mp4: "MP4 (H.264 + AAC)",
  webm: "WebM (VP9 + Opus)",
  gif: "GIF",
  webp: "WebP",
};

function checkFormats(io: CliIo, caps: FfmpegCaps): void {
  for (const [format, label] of Object.entries(FORMAT_LABELS) as Array<[keyof typeof FORMAT_LABELS, string]>) {
    try {
      planVideo(format, 30, ".", caps);
      if (format === "mp4" || format === "webm") planMux(format, PROBE_MUX, caps);
      report(io, "ok", `  ${format}`, label);
    } catch (error) {
      report(io, "warn", `  ${format}`, errorMessage(error));
    }
  }
}

async function checkFfmpeg(io: CliIo, host: HostEnv, flag: string | undefined): Promise<boolean> {
  try {
    const found = await findFfmpeg(systemFfmpegDeps(host), { flag });
    const caps = await probeFfmpeg(found.path);
    report(io, "ok", "ffmpeg", `${formatFfmpegVersion(found.version)} at ${found.path} (from ${found.source})`);
    checkFormats(io, caps);
    return true;
  } catch (error) {
    report(io, "fail", "ffmpeg", errorMessage(error), error instanceof CliError ? error.hint : undefined);
    report(io, "ok", "  png-seq", "PNG frames + WAV (works without ffmpeg)");
    return false;
  }
}

async function run(argv: string[], ctx: CommandContext): Promise<number> {
  const { io } = ctx;
  const { values, positionals } = parseCommand("doctor", argv, OPTIONS);
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  expectPositionals("doctor", positionals, []);
  const host = ctx.host ?? systemHost(ctx.env);

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeOk = nodeMajor >= MIN_NODE_MAJOR;
  report(
    io,
    nodeOk ? "ok" : "fail",
    "Node.js",
    process.versions.node,
    nodeOk ? undefined : `Install Node.js ${MIN_NODE_MAJOR} or newer`,
  );
  const browserOk = await checkBrowser(io, host, values.chrome);
  const ffmpegOk = await checkFfmpeg(io, host, values.ffmpeg);

  const assets = ctx.assets ?? locateAssets(ctx.env);
  const rebuild = "Reinstall swarmloom (in a source checkout: pnpm build)";
  const renderOk = Boolean(assets.renderDir);
  report(
    io,
    renderOk ? "ok" : "fail",
    "Render page",
    assets.renderDir ?? "not bundled",
    renderOk ? undefined : rebuild,
  );
  report(
    io,
    assets.snapshotBundle ? "ok" : "warn",
    "Snapshot script",
    assets.snapshotBundle ?? "not bundled (needed by snapshot and web page renders)",
  );
  report(io, assets.studioDir ? "ok" : "warn", "Studio", assets.studioDir ?? "not bundled (needed by serve)");

  const ready = nodeOk && browserOk && ffmpegOk && renderOk;
  io.out("");
  io.out(ready ? "Ready: swarmloom render can run on this machine." : "Not ready: fix the items marked above.");
  return ready ? ExitCode.Ok : ExitCode.MissingDependency;
}

export const doctorCommand: Command = {
  name: "doctor",
  summary: "doctor                Check Chrome/Chromium and ffmpeg, print fixes",
  help: HELP,
  run,
};
