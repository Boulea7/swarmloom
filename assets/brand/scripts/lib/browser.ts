import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";

/**
 * Chromium used for rasterising: $SWARMLOOM_CHROME, else ~/bin/chromium, else Playwright's own build.
 * Mirrors the lookup of the repository's browser test project.
 */
export function chromePath(): string | undefined {
  const fromEnv = process.env.SWARMLOOM_CHROME;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`SWARMLOOM_CHROME points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const home = join(homedir(), "bin", "chromium");
  return existsSync(home) ? home : undefined;
}

/** Runs `fn` with a headless Chromium and always closes it, even when `fn` throws. */
export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const executablePath = chromePath();
  const browser = await chromium.launch({
    executablePath,
    // Fixed colour pipeline so rasters do not depend on the host display profile.
    args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** One raster job: an HTML document captured at a CSS size and device scale. */
export interface Shot {
  html: string;
  width: number;
  height: number;
  /** Device pixel ratio (default 1). The PNG is width*scale x height*scale pixels. */
  scale?: number;
  /** Keep the alpha channel instead of painting the default white page background. */
  transparent?: boolean;
  /** Pause every animation at this time (ms) before capturing. */
  atMs?: number;
  /** Emulated `prefers-reduced-motion`. */
  reducedMotion?: boolean;
}

async function settle(page: Page, atMs: number | undefined): Promise<void> {
  await page.evaluate(async (ms) => {
    await document.fonts.ready;
    if (ms === undefined) return;
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = ms;
    }
  }, atMs);
}

/** Renders `shot` and returns the PNG bytes. A fresh page per shot keeps jobs independent. */
export async function capture(browser: Browser, shot: Shot): Promise<Buffer> {
  if (!(shot.width > 0 && shot.height > 0)) throw new Error(`invalid shot size ${shot.width}x${shot.height}`);
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: shot.scale ?? 1,
    reducedMotion: shot.reducedMotion ? "reduce" : "no-preference",
  });
  try {
    await page.setContent(shot.html, { waitUntil: "load" });
    await settle(page, shot.atMs);
    return await page.screenshot({
      type: "png",
      omitBackground: shot.transparent === true,
      clip: { x: 0, y: 0, width: shot.width, height: shot.height },
      animations: shot.atMs === undefined ? "disabled" : "allow",
    });
  } finally {
    await page.close();
  }
}

/** Minimal HTML page that shows `body` at the top-left corner with no margins or background. */
export function page(body: string, opts: { css?: string; background?: string } = {}): string {
  const bg = opts.background ?? "transparent";
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${bg}}svg{display:block}${opts.css ?? ""}</style></head><body>${body}</body></html>`;
}
