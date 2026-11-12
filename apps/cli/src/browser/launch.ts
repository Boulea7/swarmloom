import type { Browser, BrowserContext, Page } from "playwright-core";
import { errorMessage, MissingDependencyError } from "../errors";
import type { CliIo } from "../io";

/**
 * Flags for stable, repeatable frames: sRGB output, grayscale text antialiasing, no hinting
 * differences, no partial raster, no throttling of the (hidden) page, and SwiftShader as WebGL
 * fallback on GPU-less hosts. Partial raster redraws only the changed part of a tile, so antialiased
 * edges (rounded corners) came out one level apart depending on how many frames the browser drew
 * between two captures. Frames are not paced to a 60 Hz display, so the few animation frames the
 * render page waits for per video frame (until the browser has rastered it) cost no more than their work.
 * No font subpixel positioning: Chromium on Linux turns it on per font size from the device scale
 * factor it sees when it first lays out that size, and with --scale above 1 that changed from run
 * to run; a heading that grew to a new size then sat one pixel higher or lower for the rest of the
 * video in some takes of the same render.
 * SwiftShader runs the WebGL of the pages it opens, web pages included, so it relies on the GPU
 * process sandbox that launchBrowser keeps on.
 */
export const CHROME_ARGS = [
  "--hide-scrollbars",
  "--mute-audio",
  "--force-color-profile=srgb",
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--disable-font-subpixel-positioning",
  "--disable-partial-raster",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--enable-unsafe-swiftshader",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
];

const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Chromium's own reports that its sandbox cannot start: no usable user namespaces (Ubuntu 23.10+
 * AppArmor, Docker's seccomp profile), running as root, or a SUID helper with the wrong owner or mode.
 * Playwright sums up the first two as "Chromium sandboxing failed!".
 */
const SANDBOX_FAILURE = /sandboxing failed|no usable sandbox|without --no-sandbox|suid sandbox|move to new namespace/i;

const UNSANDBOXED_WARNING =
  "the browser's sandbox does not start on this machine (as root, or with user namespaces turned off), so it runs without one; only open pages you trust";

/**
 * Launches the browser headless with its sandbox on: render and snapshot open web pages with
 * JavaScript on, and without the sandbox a bug such a page triggers in Chromium runs as the user.
 * Where the sandbox cannot start, it launches once more without it and calls `onUnsandboxed` with
 * a warning to show. Playwright's own signal handlers are disabled: the CLI handles Ctrl+C itself
 * so it can remove temporary files before exiting.
 *
 * @throws MissingDependencyError when the executable does not start.
 */
export async function launchBrowser(
  executablePath: string,
  onUnsandboxed: (warning: string) => void,
): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const launch = (chromiumSandbox: boolean) =>
    chromium.launch({
      executablePath,
      headless: true,
      chromiumSandbox,
      args: CHROME_ARGS,
      timeout: LAUNCH_TIMEOUT_MS,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  try {
    try {
      return await launch(true);
    } catch (error) {
      if (!SANDBOX_FAILURE.test(errorMessage(error))) throw error;
      const browser = await launch(false);
      onUnsandboxed(UNSANDBOXED_WARNING);
      return browser;
    }
  } catch (error) {
    const first = errorMessage(error).split("\n")[0];
    throw new MissingDependencyError(
      `Could not start the browser at ${executablePath}: ${first}`,
      "Check that it is a Chromium-based browser (Chrome, Chromium, Edge, Brave) and runs on this machine; see swarmloom doctor.",
      { cause: error },
    );
  }
}

export interface ContextOptions {
  width: number;
  height: number;
  /** deviceScaleFactor: output pixels per CSS pixel. */
  scale: number;
  colorScheme: "light" | "dark";
  locale: string;
  /** Needed to inject scripts into arbitrary pages regardless of their Content-Security-Policy. */
  bypassCSP?: boolean;
}

/** A fresh context with a fixed viewport, scale, locale and UTC time zone, service workers blocked. */
export function newContext(browser: Browser, opts: ContextOptions): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.scale,
    colorScheme: opts.colorScheme,
    locale: opts.locale,
    timezoneId: "UTC",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    bypassCSP: opts.bypassCSP ?? false,
  });
}

/** Recent page errors, kept to explain failures. */
export interface PageLog {
  recent(): string[];
}

/**
 * Collects uncaught page errors and console errors (last 10). With `verbose`, every console message
 * is echoed to stderr prefixed with [page].
 */
export function watchPage(page: Page, io: CliIo, verbose: boolean): PageLog {
  const lines: string[] = [];
  const keep = (line: string) => {
    lines.push(line);
    if (lines.length > 10) lines.shift();
  };
  page.on("pageerror", (error) => {
    keep(error.message);
    if (verbose) io.err(`[page] uncaught: ${error.message}`);
  });
  page.on("console", (message) => {
    // The automatic favicon request and requests the network policy refused (reported separately)
    // are noise, not causes of failures.
    const favicon = message.location().url.endsWith("/favicon.ico");
    const blocked = message.text().includes("ERR_BLOCKED_BY_CLIENT");
    if (message.type() === "error" && !favicon && !blocked) keep(message.text());
    if (verbose) io.err(`[page] ${message.type()}: ${message.text()}`);
  });
  return { recent: () => [...lines] };
}
