import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import type { Page } from "playwright";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

/** Local Chrome for browser tests: $SWARMLOOM_CHROME, else ~/bin/chromium, else Playwright's bundled build. */
function localChrome(): string | undefined {
  const fromEnv = process.env.SWARMLOOM_CHROME;
  if (fromEnv) return fromEnv;
  const home = join(homedir(), "bin", "chromium");
  return existsSync(home) ? home : undefined;
}

const executablePath = localChrome();
/** Local Firefox for the Firefox project: $SWARMLOOM_FIREFOX, else Playwright's bundled build. */
const firefoxPath = process.env.SWARMLOOM_FIREFOX || undefined;

/**
 * Browser tests that also run in Firefox and WebKit, whose SVG foreignObject rasterising, native
 * form and video controls, media queries, WebCodecs, animated images and scrolling differ from
 * Chromium's: the in-browser exporter and its rasteriser, the stage's frame determinism (still GIFs,
 * exact scroll offsets), the SVG drawing's SMIL clock, the export's pinned media features, the
 * go-live page and the offline sound render (old WebKit's event-only `startRendering()` and the
 * engine-dependent `suspend()`/`resume()` slicing). Cases built on Chromium-only APIs (CDP) and
 * other engine-specific cases skip themselves or loosen their bounds.
 */
const crossBrowserTests = [
  "packages/adapter-svg/test/smil.browser.test.ts",
  "packages/core/test/sound/offline.browser.test.ts",
  "packages/core/test/stage/stage.browser.test.ts",
  "packages/export/test/browser-export.browser.test.ts",
  "packages/export/test/export.browser.test.ts",
  "packages/export/test/export-media.browser.test.ts",
  "packages/export/test/raster*.browser.test.ts",
];

/**
 * `commands.emulateMedia` for browser tests: a color scheme, reduced motion or forced colors for the
 * test page and its frames, in every engine (CDP's emulation is Chromium's alone).
 */
const emulateMedia: BrowserCommand<[Parameters<Page["emulateMedia"]>[0]]> = async ({ page }, media) => {
  await page.emulateMedia(media);
};
const commands = { emulateMedia };

export default defineConfig({
  resolve: {
    // Workspace packages resolve to src/ so tests never depend on built dist/ output.
    conditions: ["@swarmloom/source", ...defaultClientConditions],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["packages/*/test/**/*.browser.test.ts", "apps/*/test/**/*.browser.test.ts"],
          // One file at a time: Chromium throttles requestAnimationFrame and screenshots in the
          // background pages of parallel files, which timed out frame-driven tests in full runs.
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: executablePath ? { executablePath } : {} }),
            instances: [{ browser: "chromium" }],
            commands,
          },
        },
      },
      {
        extends: true,
        test: {
          name: "firefox",
          include: crossBrowserTests,
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: firefoxPath ? { executablePath: firefoxPath } : {} }),
            instances: [{ browser: "firefox" }],
            commands,
          },
        },
      },
      {
        extends: true,
        test: {
          // Safari's engine: Playwright's WebKit build (needs its system libraries, as on CI's Ubuntu).
          name: "webkit",
          include: crossBrowserTests,
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "webkit" }],
            commands,
          },
        },
      },
    ],
  },
});
