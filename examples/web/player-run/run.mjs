#!/usr/bin/env node
/**
 * Player run harness: plays examples/web/demo.html with the real player in headless Chromium,
 * screenshots every second of a VirtualClock run, writes a contact sheet and prints timings,
 * then times a seek back to the middle of the build. With --realtime it instead plays on the real
 * clock and counts long tasks (> 50 ms). --scrubber shows the toolbar's seek bar.
 *
 *   node examples/web/player-run/run.mjs <outDir> [--follow scroll|tour|none] [--realtime] [--scrubber] [--seed 7]
 *
 * Browser: $SWARMLOOM_CHROME, else Playwright's own Chromium. Not part of the unit suites.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    follow: { type: "string", default: "scroll" },
    realtime: { type: "boolean", default: false },
    scrubber: { type: "boolean", default: false },
    seed: { type: "string", default: "7" },
  },
});
const out = resolve(positionals[0] ?? "player-run-out");
if (!["scroll", "tour", "none"].includes(values.follow)) throw new Error(`bad --follow ${values.follow}`);
const seed = Number(values.seed);
if (!Number.isInteger(seed)) throw new Error(`bad --seed ${values.seed}`);
mkdirSync(out, { recursive: true });

const bundle = await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  write: false,
  format: "iife",
  conditions: ["@swarmloom/source"],
  // examples/ is not a workspace package: point the bare names at the package sources.
  alias: {
    "@swarmloom/core": join(root, "packages/core/src/index.ts"),
    "@swarmloom/snapshot-dom": join(root, "packages/snapshot-dom/src/index.ts"),
  },
  logLevel: "warning",
});
const script = bundle.outputFiles[0].text;
const VIEW = { width: 1280, height: 800 };
const MAX_MS = 240_000;

const browser = await chromium.launch({ executablePath: process.env.SWARMLOOM_CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: VIEW });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(pathToFileURL(join(here, "..", "demo.html")).href);
  await page.addScriptTag({ content: script });
  if (values.realtime) await realtime(page);
  else await stepped(page);
} finally {
  await browser.close();
}

async function stepped(page) {
  await page.screenshot({ path: join(out, "frame-original.png") });
  const layers = await page.evaluate((o) => window.__swl.start(o), {
    follow: values.follow,
    seed,
    scrubber: values.scrubber,
  });
  const frames = [];
  let state = "";
  for (let t = 1000; state !== "done" && t <= MAX_MS; t += 1000) {
    state = await page.evaluate(() => window.__swl.advance(1000));
    const file = join(out, `t${String(t / 1000).padStart(3, "0")}s-${state}.png`);
    await page.screenshot({ path: file });
    frames.push(file);
  }
  const m = await page.evaluate(() => window.__swl.metrics());
  writeFileSync(join(out, "metrics.json"), `${JSON.stringify(m, null, 2)}\n`);
  console.log(`layers ${layers} (first screen ${m.firstScreenLayers})`);
  console.log(`first screen complete ${sec(m.firstScreenAt)}, build complete ${sec(m.builtAt)}, done ${sec(m.doneAt)}`);
  console.log(`work outside the viewport ${sec(m.outOfSightMs)}, frames ${frames.length}`);
  await contactSheet(page, frames);
  if (m.builtAt !== null) {
    const at = Math.round(m.builtAt / 2);
    const ms = await page.evaluate((t) => window.__swl.seek(t), at);
    await page.screenshot({ path: join(out, "seek-middle.png") });
    console.log(`seek to ${sec(at)} blocked the page for ${Math.round(ms)} ms`);
  }
}

async function realtime(page) {
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    }).observe({ type: "longtask", buffered: false });
  });
  await page.evaluate((o) => window.__swl.start(o), {
    follow: values.follow,
    seed,
    realtime: true,
    scrubber: values.scrubber,
  });
  await page.waitForFunction(() => window.__swl.metrics().state === "done", null, { timeout: MAX_MS, polling: 500 });
  const m = await page.evaluate(() => window.__swl.metrics());
  const long = await page.evaluate(() => window.__longTasks);
  writeFileSync(join(out, "metrics-realtime.json"), `${JSON.stringify({ ...m, longTasks: long }, null, 2)}\n`);
  console.log(
    `realtime: first screen ${sec(m.firstScreenAt)}, build complete ${sec(m.builtAt)}, done ${sec(m.doneAt)}`,
  );
  console.log(`long tasks ${long.length} [${long.join(", ")}] ms`);
}

/** Nine evenly spread frames (first and last included) in a 3 x 3 grid at half size. */
async function contactSheet(page, frames) {
  const pick = [...new Set(Array.from({ length: 9 }, (_, i) => frames[Math.round((i * (frames.length - 1)) / 8)]))];
  const cells = pick
    .map((f) => {
      const name = f.split("/").pop();
      return `<figure><img src="${name}"><figcaption>${name}</figcaption></figure>`;
    })
    .join("");
  const html = join(out, "contact-sheet.html");
  writeFileSync(
    html,
    `<!doctype html><style>body{margin:0;display:grid;grid-template-columns:repeat(3,640px);font:14px sans-serif}
     figure{margin:0;position:relative}img{width:640px;height:400px;display:block}
     figcaption{position:absolute;left:6px;top:6px;padding:2px 6px;background:#000c;color:#fff;border-radius:4px}</style>${cells}`,
  );
  const sheet = await page
    .context()
    .browser()
    .newPage({ viewport: { width: 1920, height: 1200 } });
  await sheet.goto(pathToFileURL(html).href);
  await sheet.screenshot({ path: join(out, "contact-sheet.png"), fullPage: true });
  await sheet.close();
}

function sec(ms) {
  return ms === null || ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)} s`;
}
