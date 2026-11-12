import type { Browser, BrowserContext, Page } from "playwright-core";
import { errorMessage, MissingDependencyError } from "../errors";
import type { CliIo } from "../io";

/**
 * Flags for stable, repeatable frames: sRGB output, grayscale text antialiasing, no hinting
 * differences, no partial raster, no throttling of the (hidden) page, and SwiftShader as WebGL
 * fallback on GPU-less hosts. Partial raster redraws only the changed part of a tile, so antialiased
 * edges (rounded corners) came out one level apart depending on how many frames the browser drew
 * between two captures.
 */
export const CHROME_ARGS = [
  "--hide-scrollbars",
  "--mute-audio",
  "--force-color-profile=srgb",
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--disable-partial-raster",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--enable-unsafe-swiftshader",
];

const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Launches the browser headless. Playwright's own signal handlers are disabled: the CLI handles
 * Ctrl+C itself so it can remove temporary files before exiting.
 *
 * @throws MissingDependencyError when the executable does not start.
 */
export async function launchBrowser(executablePath: string): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  try {
    return await chromium.launch({
      executablePath,
      headless: true,
      args: CHROME_ARGS,
      timeout: LAUNCH_TIMEOUT_MS,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
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
