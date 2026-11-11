#!/usr/bin/env node
// Performance benchmark (`pnpm bench`). Plays the demo page and a synthetic 4k-layer page in
// headless Chromium (1280x800, DPR 1, sound off) and records snapshot time, build FPS, the
// per-frame cost of rAF callbacks, frames over 33 ms, long tasks, mounted stage nodes and heap,
// then checks them against the budgets in scripts/bench/lib.mjs. Exits 1 when a budget fails.
//
//   node scripts/bench.mjs [--write] [--json [<file>]] [--report-only] [--chrome <path>]
//
//   --write        put the results tables into docs/benchmarks.md and docs/en/benchmarks.md
//   --json <file>  also save the raw results; without a file (or with -) print them to stdout
//                  and send the readable report to stderr
//   --report-only  print the results but exit 0 even when a budget fails
//   --chrome       browser executable (default $SWARMLOOM_CHROME, then ~/bin/chromium, then Playwright's)
//
// Run it alone on a quiet machine: timing budgets assume nothing else competes for the CPU.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, homedir, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUDGETS,
  checkBudgets,
  frameStats,
  JSON_STDOUT,
  parseBenchArgs,
  REFERENCE,
  renderTable,
  replaceSection,
  syntheticPage,
} from "./bench/lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORT = { width: 1280, height: 800 };
const PAGE_URL = "http://bench.swarmloom.invalid/";
/** Cards of the synthetic page; about 4.4k layers. */
const LARGE_CARDS = 980;
/** Building window measured on the synthetic page before finish() completes it. */
const LARGE_WINDOW_MS = 8000;
const FLOCK_AGENTS = 128;
const FLOCK_WINDOW_MS = 3000;
const SEEK_TO_MS = 10_000;
const REPLAYS = 3;
/** Upper bound for one full build of the demo page; a hang fails the run instead of blocking it. */
const BUILD_TIMEOUT_MS = 120_000;

const args = parseBenchArgs(process.argv.slice(2));
/** The readable report; it moves to stderr when stdout carries the JSON results. */
const log = args.json === JSON_STDOUT ? console.error : console.log;

function chromePath() {
  if (args.chrome) return args.chrome;
  if (process.env.SWARMLOOM_CHROME) return process.env.SWARMLOOM_CHROME;
  const home = join(homedir(), "bin", "chromium");
  return existsSync(home) ? home : undefined;
}

/** Bundles the engine and the DOM snapshot from source into one IIFE that sets `window.__bench`. */
async function bundle() {
  const { build } = await import("esbuild");
  const entry = [
    'import { createPlayer } from "./packages/core/src/index.ts";',
    'import { autoAgentCount } from "./packages/core/src/engine/options.ts";',
    'import { snapshot } from "./packages/snapshot-dom/src/index.ts";',
    "globalThis.__bench = { createPlayer, snapshot, autoAgentCount };",
  ].join("\n");
  const out = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: "ts", sourcefile: "bench-entry.ts" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    conditions: ["@swarmloom/source"],
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

/**
 * Runs before any page script: times every requestAnimationFrame callback (summed per frame),
 * collects long tasks and keeps the shadow roots the player attaches (they are closed) so mounted
 * stage nodes can be counted.
 */
function instrument() {
  const m = { ts: [], cost: [], longTasks: [], roots: [], recording: false };
  window.__benchMetrics = m;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((ts) => {
      const t0 = performance.now();
      try {
        cb(ts);
      } finally {
        const spent = performance.now() - t0;
        const last = m.ts.length - 1;
        if (last >= 0 && m.ts[last] === ts) m.cost[last] += spent;
        else {
          m.ts.push(ts);
          m.cost.push(spent);
        }
      }
    });
  const keep = (entries) => {
    for (const e of entries) m.longTasks.push({ start: e.startTime, duration: e.duration });
  };
  const observer = new PerformanceObserver((list) => keep(list.getEntries()));
  observer.observe({ type: "longtask", buffered: true });
  // Entries arrive after their task ends and the observer runs later still: wait, then drain.
  m.flushLongTasks = async () => {
    await new Promise((r) => setTimeout(r, 100));
    keep(observer.takeRecords());
  };
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init);
    if (m.recording) m.roots.push(root);
    return root;
  };
  m.countNodes = () => {
    let n = 0;
    for (const r of m.roots) if (r.host.isConnected) n += r.querySelectorAll("*").length;
    return n;
  };
}

/** In the page: snapshots the document and keeps the blueprint for the build phase. */
async function snapshotPhase() {
  // Start from a timer: work run directly by the DevTools evaluate call is never reported as a long task.
  await new Promise((r) => setTimeout(r, 0));
  const t0 = performance.now();
  const bp = await window.__bench.snapshot(document);
  const snapshotMs = performance.now() - t0;
  window.__bp = bp;
  await window.__benchMetrics.flushLongTasks();
  const longest = window.__benchMetrics.longTasks
    .filter((t) => t.start + t.duration >= t0)
    .reduce((a, t) => Math.max(a, t.duration), 0);
  return { layers: bp.layers.length, snapshotMs, snapshotLongestTaskMs: longest };
}

/**
 * In the page: creates the player and plays. Resolves with the building window, either at the end
 * of the build or after `windowMs` of building, in which case finish() completes it and the time
 * to completion and mounted nodes are reported as well.
 */
async function buildPhase({ agents, windowMs, timeoutMs }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(0); // see snapshotPhase
  const m = window.__benchMetrics;
  const bp = window.__bp;
  m.recording = true;
  const player = window.__bench.createPlayer({ blueprint: bp, mode: "overlay", sound: false, seed: 1, agents });
  window.__player = player;
  let buildStart = Number.NaN;
  let peak = 0;
  player.on("state", (e) => {
    if (e.state === "building" && Number.isNaN(buildStart)) buildStart = performance.now();
  });
  const sample = () => {
    peak = Math.max(peak, m.countNodes());
  };
  const sampler = setInterval(sample, 250);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`build did not end within ${timeoutMs} ms (${player.state})`)),
      timeoutMs,
    );
  });
  const built = player.play();
  try {
    if (!windowMs) {
      await Promise.race([built, timeout]);
      sample();
      return { buildStart, buildEnd: performance.now(), peak };
    }
    while (Number.isNaN(buildStart)) await Promise.race([sleep(50), timeout]);
    await Promise.race([built, sleep(windowMs), timeout]);
    const buildEnd = performance.now();
    sample();
    const buildPeak = peak;
    peak = 0;
    player.finish();
    await Promise.race([built, timeout]);
    sample();
    return { buildStart, buildEnd, peak: buildPeak, finishPeak: peak, finishMs: performance.now() - buildEnd };
  } finally {
    clearInterval(sampler);
    clearTimeout(timer);
  }
}

/** In the page: replays the build `n` times at triple speed, waiting for each to complete. */
async function replayPhase(n) {
  const player = window.__player;
  player.setSpeed(3);
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => {
      let started = false;
      const off = player.on("state", (e) => {
        if (e.state === "building") started = true;
        else if (started && (e.state === "finale" || e.state === "done")) {
          off();
          resolve();
        }
      });
      player.replay();
    });
  }
  player.setSpeed(1);
}

/** In the page: times a seek back to `t` ms, which replays the run from the start without drawing. */
function seekPhase(t) {
  const t0 = performance.now();
  window.__player.seek(t);
  return performance.now() - t0;
}

/** In the page: completes the build quickly so the flock finale runs, then returns its start time. */
async function flockPhase() {
  const player = window.__player;
  await new Promise((resolve) => {
    const off = player.on("state", (e) => {
      if (e.state === "finale") {
        off();
        resolve();
      }
    });
    player.finish();
  });
  return performance.now();
}

async function metrics(page) {
  return page.evaluate(async () => {
    const m = window.__benchMetrics;
    await m.flushLongTasks();
    return { ts: m.ts, cost: m.cost, longTasks: m.longTasks, now: performance.now() };
  });
}

/** Used JS heap in MB after a forced garbage collection. */
async function heapMB(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return usedSize / (1024 * 1024);
}

async function openPage(browser, script, html) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(instrument);
  // Served through a route (no network) so the init script runs, as it does on a real navigation.
  await page.route(PAGE_URL, (route) => route.fulfill({ body: html, contentType: "text/html; charset=utf-8" }));
  await page.goto(PAGE_URL, { waitUntil: "load" });
  await page.addScriptTag({ content: script });
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors };
}

async function benchDemo(browser, script) {
  const html = readFileSync(join(ROOT, "examples/web/demo.html"), "utf8");
  const { context, page, cdp, errors } = await openPage(browser, script, html);
  try {
    const base = await heapMB(cdp);
    const snap = await page.evaluate(snapshotPhase);
    const agents = await page.evaluate(
      ([n, w, h]) => window.__bench.autoAgentCount(n, w * h),
      [snap.layers, VIEWPORT.width, VIEWPORT.height],
    );
    const run = await page.evaluate(buildPhase, { agents: "auto", timeoutMs: BUILD_TIMEOUT_MS });
    const m = await metrics(page);
    const build = frameStats(m, m.longTasks, run.buildStart, run.buildEnd);
    const built = await heapMB(cdp);
    await page.evaluate(replayPhase, REPLAYS);
    const replays = await heapMB(cdp);
    const seekMs = await page.evaluate(seekPhase, SEEK_TO_MS);
    if (errors.length) throw new Error(`demo page errors: ${errors.join("; ")}`);
    return {
      ...snap,
      agents,
      build,
      heapMB: { base, built, replays, leak: replays - built },
      seekMs,
    };
  } finally {
    await context.close();
  }
}

async function benchLarge(browser, script) {
  const { context, page, cdp, errors } = await openPage(browser, script, syntheticPage(LARGE_CARDS));
  try {
    const snap = await page.evaluate(snapshotPhase);
    const agents = await page.evaluate(
      ([n, w, h]) => window.__bench.autoAgentCount(n, w * h),
      [snap.layers, VIEWPORT.width, VIEWPORT.height],
    );
    const run = await page.evaluate(buildPhase, {
      agents: "auto",
      windowMs: LARGE_WINDOW_MS,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const m = await metrics(page);
    const build = frameStats(m, m.longTasks, run.buildStart, run.buildEnd);
    const built = await heapMB(cdp);
    if (errors.length) throw new Error(`synthetic page errors: ${errors.join("; ")}`);
    return {
      ...snap,
      agents,
      build,
      finishMs: run.finishMs,
      nodes: { peak: run.peak, finish: run.finishPeak },
      heapMB: { built },
    };
  } finally {
    await context.close();
  }
}

async function benchFlock(browser, script) {
  const html = readFileSync(join(ROOT, "examples/web/demo.html"), "utf8");
  const { context, page, errors } = await openPage(browser, script, html);
  try {
    await page.evaluate(snapshotPhase);
    // Start the build, then rush it so the window covers the flock finale only.
    await page.evaluate((agents) => {
      window.__player = window.__bench.createPlayer({
        blueprint: window.__bp,
        mode: "overlay",
        sound: false,
        seed: 1,
        agents,
        intro: false,
      });
      void window.__player.play();
    }, FLOCK_AGENTS);
    const from = await page.evaluate(flockPhase);
    // The flock follows the pointer: sweep it across the viewport while measuring.
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      await page.mouse.move(640 + Math.cos(a) * 400, 400 + Math.sin(a) * 250, { steps: 4 });
      await page.waitForTimeout(FLOCK_WINDOW_MS / steps);
    }
    const m = await metrics(page);
    if (errors.length) throw new Error(`flock page errors: ${errors.join("; ")}`);
    return { agents: FLOCK_AGENTS, ...frameStats(m, m.longTasks, from, m.now) };
  } finally {
    await context.close();
  }
}

function printResults(results, checks) {
  const { demo, large, flock } = results;
  const line = (name, b) =>
    `${name.padEnd(10)} fps ${b.fps.toFixed(1)}  rAF callback mean ${b.cbMean.toFixed(2)} p95 ${b.cbP95.toFixed(2)} max ${b.cbMax.toFixed(1)} ms  frames>33ms ${b.slow}/${b.frames}  long tasks ${b.longTasks} (${b.longTaskMs.toFixed(0)} ms)`;
  log(
    `bench: ${results.env.browser}, ${results.env.viewport} DPR ${results.env.dpr}, load ${results.env.load.toFixed(1)}`,
  );
  log(
    `demo       ${demo.layers} layers, ${demo.agents} agents, snapshot ${demo.snapshotMs.toFixed(0)} ms (longest task ${demo.snapshotLongestTaskMs.toFixed(0)} ms)`,
  );
  log(line("demo", demo.build));
  log(
    `demo       heap ${demo.heapMB.base.toFixed(1)} -> ${demo.heapMB.built.toFixed(1)} built -> ${demo.heapMB.replays.toFixed(1)} MB after ${REPLAYS} replays; seek(${SEEK_TO_MS}) ${demo.seekMs.toFixed(0)} ms`,
  );
  log(
    `reference  fps ${REFERENCE.fps}  long tasks ${REFERENCE.longTasks} (${REFERENCE.longTaskMs} ms)  heap peak ${REFERENCE.heapPeakMB} MB (other page and machine, with screenshots; orientation only)`,
  );
  log(
    `large      ${large.layers} layers, ${large.agents} agents, snapshot ${large.snapshotMs.toFixed(0)} ms (longest task ${large.snapshotLongestTaskMs.toFixed(0)} ms)`,
  );
  log(line("large", large.build));
  log(
    `large      stage nodes peak ${large.nodes.peak} building, ${large.nodes.finish} while finish() completes it in ${large.finishMs.toFixed(0)} ms; heap ${large.heapMB.built.toFixed(1)} MB`,
  );
  log(line(`flock x${flock.agents}`, flock));
  log("");
  for (const c of checks) {
    const v = typeof c.value === "number" ? Number(c.value.toFixed(3)) : "missing";
    log(`${c.ok ? "ok  " : "FAIL"} ${c.label}: ${v} (budget ${c.limit})`);
  }
}

function writeDocs(results, checks) {
  for (const [file, lang] of [
    ["docs/benchmarks.md", "zh"],
    ["docs/en/benchmarks.md", "en"],
  ]) {
    const path = join(ROOT, file);
    writeFileSync(path, replaceSection(readFileSync(path, "utf8"), renderTable(results, lang, checks)));
    log(`bench: wrote ${file}`);
  }
}

async function main() {
  const { chromium } = await import("playwright");
  const script = await bundle();
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling"],
  });
  try {
    const results = {
      env: {
        browser: `Chrome ${browser.version()}`,
        viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
        dpr: 1,
        cpus: cpus().length,
        load: loadavg()[0],
        date: new Date().toISOString().slice(0, 10),
      },
    };
    // One scenario at a time: parallel pages would compete for the same main-thread budget.
    results.demo = await benchDemo(browser, script);
    results.large = await benchLarge(browser, script);
    results.flock = await benchFlock(browser, script);
    const checks = checkBudgets(results, BUDGETS);
    printResults(results, checks);
    const json = `${JSON.stringify({ ...results, checks }, null, 2)}\n`;
    if (args.json === JSON_STDOUT) process.stdout.write(json);
    else if (args.json) writeFileSync(resolve(args.json), json);
    if (args.write) writeDocs(results, checks);
    const failed = checks.filter((c) => !c.ok).length;
    if (failed && !args.reportOnly) {
      console.error(`bench: ${failed} budget(s) failed`);
      process.exitCode = 1;
    } else if (!failed) log("bench: all budgets met");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`bench: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
