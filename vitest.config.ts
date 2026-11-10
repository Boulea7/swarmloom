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
    ],
  },
});
