/**
 * Captures Studio screenshots for visual review into test/__screens__/ (gitignored):
 * home and player at desktop, phone, foldable (two 540x720 segments) and watch sizes, plus
 * documents playing in the real app.
 *
 *   SWARMLOOM_CHROME=$HOME/bin/chromium pnpm -F @swarmloom/studio screens [name-filter]
 *
 * It starts a Vite dev server on a free port and stops everything it started when done. Most shots
 * open test/screens/ (the real UI with a fake player, deterministic); `app` shots open Studio itself
 * (real adapters and core player) and capture the build `waitMs` after it starts, so they vary a
 * little from run to run.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "test/__screens__");
mkdirSync(out, { recursive: true });

const PLAYER = "?example=svg-chart&autoplay=1";
/** A document from the second-wave adapters, played by the real engine. */
const DOCUMENT = "?example=odf-report&autoplay=1";

/** name, viewport, query, extra options */
const SHOTS = [
  { name: "home-1440x900", size: [1440, 900], query: "" },
  { name: "home-1440x900-dark", size: [1440, 900], query: "?theme=dark" },
  { name: "player-1440x900", size: [1440, 900], query: PLAYER },
  { name: "player-1440x900-settings", size: [1440, 900], query: PLAYER, keys: ["s"] },
  { name: "home-390x844", size: [390, 844], query: "", mobile: true, full: true },
  { name: "home-390x844-dark", size: [390, 844], query: "?theme=dark", mobile: true },
  { name: "player-390x844", size: [390, 844], query: PLAYER, mobile: true },
  { name: "player-390x844-sheet", size: [390, 844], query: PLAYER, mobile: true, keys: ["s"] },
  { name: "home-fold-2x540x720", size: [1080, 720], query: "", fold: true },
  { name: "player-fold-2x540x720", size: [1080, 720], query: PLAYER, fold: true },
  { name: "watch-240x240", size: [240, 240], query: "?watch=1", mobile: true },
  { name: "watch-240x240-round", size: [240, 240], query: "?watch=1&round=1", mobile: true },
  { name: "watch-240x240-round-dark", size: [240, 240], query: "?round=1&theme=dark", mobile: true },
  { name: "doc-1440x900", size: [1440, 900], query: DOCUMENT, app: true, waitMs: 10000 },
  { name: "doc-1440x900-dark", size: [1440, 900], query: `${DOCUMENT}&theme=dark`, app: true, waitMs: 10000 },
  { name: "doc-390x844", size: [390, 844], query: DOCUMENT, app: true, mobile: true, waitMs: 10000 },
  {
    name: "doc-390x844-dark",
    size: [390, 844],
    query: `${DOCUMENT}&theme=dark`,
    app: true,
    mobile: true,
    waitMs: 10000,
  },
];
const filter = process.argv[2] ?? "";

const server = await createServer({
  root,
  configFile: resolve(root, "vite.config.ts"),
  logLevel: "warn",
  server: { port: 0, host: "127.0.0.1", strictPort: false },
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === "object" && address ? address.port : 0;
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ executablePath: process.env.SWARMLOOM_CHROME || undefined, headless: true });
try {
  for (const shot of SHOTS.filter((s) => s.name.includes(filter))) {
    const [width, height] = shot.size;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: Boolean(shot.mobile),
      hasTouch: Boolean(shot.mobile),
      // The real player shows the swarm only with motion allowed.
      reducedMotion: shot.app ? "no-preference" : "reduce",
      locale: "zh-CN",
    });
    const page = await context.newPage();
    if (shot.fold) {
      // Two 540 px segments side by side, no hinge mask: Viewport Segments emulated through CDP
      // (the display feature only takes effect as part of a device metrics override).
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: false,
        displayFeature: { orientation: "vertical", offset: width / 2, maskLength: 0 },
      });
      await cdp.send("Emulation.setDevicePostureOverride", { posture: { type: "folded" } }).catch(() => undefined);
    }
    page.on("pageerror", (error) => console.warn(`[screens] ${shot.name}: ${error.message}`));
    const path = shot.app ? "/index.html" : "/test/screens/index.html";
    await page.goto(`${origin}${path}${shot.query}`, { waitUntil: "load" });
    if (shot.app) {
      await page.waitForSelector(".view-player[data-phase='playing']", { timeout: 30_000 }).catch(() => undefined);
    } else {
      await page.waitForSelector("html[data-screens-ready]");
      if (shot.query.includes("example="))
        await page.waitForSelector(".stage-host [data-fake-stage]", { timeout: 15_000 }).catch(() => undefined);
    }
    for (const key of shot.keys ?? []) await page.keyboard.press(key);
    await page.waitForTimeout(shot.waitMs ?? 450);
    const segments = await page.evaluate(() => matchMedia("(horizontal-viewport-segments: 2)").matches);
    await page.screenshot({ path: resolve(out, `${shot.name}.png`), fullPage: Boolean(shot.full) });
    console.log(`${shot.name}.png${shot.fold ? ` (segments: ${segments})` : ""}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
