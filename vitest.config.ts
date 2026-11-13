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
/**
 * Chromium switches for the browser project. Without a GPU (CI runners, servers) WebGL comes from the
 * SwiftShader software rasteriser, which Chromium only allows behind this switch; Playwright passes it today too.
 */
const chromiumArgs = ["--enable-unsafe-swiftshader"];
/**
 * Whether a browser test must fail, not skip, when the browser lacks a capability it checks (WebGL 2): on CI
 * (`CI=1` or `CI=true`), unless the job sets SWARMLOOM_TEST_DEPS=optional, as for the CLI tests' real browser and
 * ffmpeg. A launch switch or runner image that loses WebGL then fails the job instead of skipping the GPU cases.
 */
const requireWebGL = /^(1|true)$/i.test(process.env.CI ?? "") && process.env.SWARMLOOM_TEST_DEPS !== "optional";
/** Local Firefox for the Firefox project: $SWARMLOOM_FIREFOX, else Playwright's bundled build. */
const firefoxPath = process.env.SWARMLOOM_FIREFOX || undefined;

/**
 * Browser tests that also run in Firefox and WebKit, whose SVG foreignObject rasterising, native
 * form and video controls, media queries, WebCodecs, animated images and scrolling differ from
 * Chromium's: the in-browser exporter and its rasteriser, the stage's frame determinism (still GIFs,
 * exact scroll offsets, unseen engine ticks left unpainted), the SVG drawing's SMIL clock, the
 * export's pinned media features, the go-live page, the offline sound render (old WebKit's
 * event-only `startRendering()` and the engine-dependent `suspend()`/`resume()` slicing) and the
 * Studio watch QR notice's keyboard focus and scrolling (WebKit puts no scroller in the Tab order).
 * Cases built on Chromium-only APIs (CDP) and other engine-specific cases skip themselves or loosen
 * their bounds.
 */
const crossBrowserTests = [
  "apps/studio/test/watch-notice.browser.test.ts",
  "packages/adapter-svg/test/smil.browser.test.ts",
  "packages/core/test/sound/offline.browser.test.ts",
  "packages/core/test/stage/stage.browser.test.ts",
  "packages/core/test/stage/unseen-frames.browser.test.ts",
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
/** What lets the image loads `holdImage` holds go on, by URL. */
const heldImages = new Map<string, () => void>();
/**
 * `commands.holdImage(url, svg)` for browser tests: serves the SVG `svg` at `url`, but the test page
 * and its frames load it as an image only once `commands.releaseImage(url)` is called, as from a slow
 * server, in every engine. Other requests for it (the rasteriser's fetch) get it at once.
 */
const holdImage: BrowserCommand<[url: string, svg: string]> = async ({ page }, url, svg) => {
  const released = new Promise<void>((resolve) => heldImages.set(url, resolve));
  await page.route(url, async (route) => {
    if (route.request().resourceType() === "image") await released;
    await route.fulfill({ body: svg, contentType: "image/svg+xml" });
  });
};
const releaseImage: BrowserCommand<[url: string]> = (_, url) => {
  heldImages.get(url)?.();
  heldImages.delete(url);
};
const commands = { emulateMedia, holdImage, releaseImage };

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
          // Read by inject("requireWebGL") (packages/adapter-three/test/adapter-three.browser.test.ts).
          provide: { requireWebGL },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: { args: chromiumArgs, ...(executablePath ? { executablePath } : {}) },
            }),
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
