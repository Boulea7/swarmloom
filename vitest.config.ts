import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";

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
 * Browser tests that also run in Firefox, whose SVG foreignObject rasterising and WebCodecs differ
 * from Chromium's: the in-browser exporter and its rasteriser. Tests that use Chromium-only APIs
 * (CDP, as in export-media) stay out.
 */
const firefoxTests = [
  "packages/export/test/browser-export.browser.test.ts",
  "packages/export/test/raster*.browser.test.ts",
];

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
          },
        },
      },
      {
        extends: true,
        test: {
          name: "firefox",
          include: firefoxTests,
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: firefoxPath ? { executablePath: firefoxPath } : {} }),
            instances: [{ browser: "firefox" }],
          },
        },
      },
    ],
  },
});
