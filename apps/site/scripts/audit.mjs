#!/usr/bin/env node
/**
 * Performance and accessibility audit of the built site (apps/site/dist), in real Chromium.
 *
 * Serves dist/ over gzip on a free local port, loads each page on a desktop and a mobile profile
 * (network and CPU throttled through the DevTools protocol) and reports:
 *   - LCP, FCP and CLS from the page's own PerformanceObserver entries;
 *   - JS transferred (gzip) before the load event, and in total once the live hero has loaded;
 *   - structural accessibility issues (lang, landmarks, one h1, names of links and buttons, alt
 *     text, duplicate ids, captions) and text contrast below WCAG AA.
 *
 * Usage: node scripts/audit.mjs [--base /swarmloom/] [--strict] [--json]
 * Chromium: $SWARMLOOM_CHROME, else ~/bin/chromium, else Playwright's own build.
 * Exit code 1 on accessibility issues or a first-load JS budget overrun; timing budgets only fail
 * with --strict because a shared machine makes them noisy.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

/** Budgets from contracts/site-brief.md. */
export const BUDGET = { firstLoadJsKb: 90, lcpMs: 1800, cls: 0.1 };

/** Throttling profiles; the networks approximate Chrome DevTools' "Fast 4G" and Lighthouse's mobile preset. */
export const PROFILES = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    mobile: false,
    cpu: 1,
    network: { latency: 40, downloadKbps: 10240, uploadKbps: 10240 },
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    mobile: true,
    cpu: 4,
    network: { latency: 60, downloadKbps: 9000, uploadKbps: 1500 },
  },
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".svg", ".json", ".xml", ".txt", ".vtt"]);

/**
 * Maps a request path to a file in `root`, or null outside it. Directory paths serve index.html.
 * @param {string} root
 * @param {string} base Public base path, with leading and trailing slash.
 * @param {string} urlPath
 * @returns {string | null}
 */
export function resolveFile(root, base, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split("?")[0] ?? "");
  } catch {
    return null;
  }
  if (!path.startsWith(base)) return null;
  const rel = path.slice(base.length);
  const file = normalize(join(root, rel.endsWith("/") || rel === "" ? `${rel}index.html` : rel));
  if (file !== root && !file.startsWith(`${root}/`)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * Static server for dist/ with gzip, like GitHub Pages; unknown paths get 404.html.
 * @param {string} root Absolute dist directory.
 * @param {string} base Public base path, with leading and trailing slash.
 * @returns {Promise<{ server: import("node:http").Server, origin: string }>}
 */
export function serve(root, base) {
  const server = createServer((req, res) => {
    const file = resolveFile(root, base, req.url ?? "/");
    const status = file ? 200 : 404;
    const target = file ?? join(root, "404.html");
    const ext = extname(target);
    let body = existsSync(target) ? readFileSync(target) : Buffer.from("Not found");
    const headers = { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" };
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
      body = gzipSync(body, { level: 6 });
      headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(status, { ...headers, "Content-Length": body.length });
    res.end(body);
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

function chromePath() {
  if (process.env.SWARMLOOM_CHROME) return process.env.SWARMLOOM_CHROME;
  const home = join(homedir(), "bin", "chromium");
  return existsSync(home) ? home : undefined;
}

/** Installed before any page script: collects paint and layout-shift entries. */
function collectVitals() {
  const vitals = { lcp: 0, lcpElement: "", fcp: 0, cls: 0 };
  Object.defineProperty(window, "__vitals", { value: vitals });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      vitals.lcp = entry.startTime;
      const el = entry.element;
      vitals.lcpElement = el ? `${el.localName}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}` : "";
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name === "first-contentful-paint") vitals.fcp = entry.startTime;
  }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) vitals.cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
}

/** Runs in the page: structural accessibility checks and WCAG AA text contrast. */
function inspectPage() {
  const issues = [];
  const name = (el) =>
    (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim() ||
    [...el.querySelectorAll("img[alt]")]
      .map((img) => img.alt)
      .join("")
      .trim();
  if (!document.documentElement.lang) issues.push("html has no lang");
  for (const tag of ["main", "nav", "footer"]) if (!document.querySelector(tag)) issues.push(`no <${tag}> landmark`);
  const h1 = document.querySelectorAll("h1").length;
  if (h1 !== 1) issues.push(`${h1} h1 elements`);
  for (const el of document.querySelectorAll("a[href], button")) {
    if (el.closest("[hidden], [aria-hidden='true']")) continue;
    if (!name(el)) issues.push(`unnamed ${el.localName}: ${el.outerHTML.slice(0, 80)}`);
  }
  for (const img of document.querySelectorAll("img:not([alt])")) issues.push(`img without alt: ${img.src}`);
  const ids = new Map();
  for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) issues.push(`duplicate id "${id}" (${n}x)`);
  for (const video of document.querySelectorAll("video:not([aria-hidden='true'])")) {
    if (!video.querySelector("track[kind='captions']")) issues.push("film without captions");
  }

  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const lin = (channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  /** Effective background: opaque colours stacked up the ancestor chain; null over images. */
  const backgroundOf = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) bg = over(layer, bg);
    return bg;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const el = text.parentElement;
    if (!el || seen.has(el) || !text.textContent.trim()) continue;
    seen.add(el);
    if (el.closest("[hidden], [aria-hidden='true'], svg, .sr-only, .skip")) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width === 0 || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const bg = backgroundOf(el);
    const fg = parse(style.color);
    if (!bg || !fg) continue;
    const color = over(fg, bg);
    const [hi, lo] = [luminance(color), luminance(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = Number.parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      issues.push(
        `contrast ${ratio.toFixed(2)} "${text.textContent.trim().slice(0, 32)}" (${el.localName}.${el.className})`,
      );
    }
  }
  return issues;
}

async function audit(browser, url, profileName, scheme) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.network.latency,
    downloadThroughput: (profile.network.downloadKbps * 1024) / 8,
    uploadThroughput: (profile.network.uploadKbps * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  await page.addInitScript(collectVitals);
  await page.goto(url, { waitUntil: "load" });
  const atLoad = await page.evaluate(() => performance.getEntriesByType("resource").length);
  // Long enough for the idle callback that imports the live hero and for its chunks to arrive.
  await page.waitForTimeout(4000);
  const result = await page.evaluate((loadCount) => {
    const scripts = performance
      .getEntriesByType("resource")
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.initiatorType === "script" || /\.m?js(\?|$)/.test(entry.name));
    const kb = (list) => list.reduce((sum, { entry }) => sum + entry.transferSize, 0) / 1024;
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      ...window.__vitals,
      htmlKb: (nav?.transferSize ?? 0) / 1024,
      jsFirstLoadKb: kb(scripts.filter(({ index }) => index < loadCount)),
      jsTotalKb: kb(scripts),
      hero: document.querySelector("[data-hero]")?.dataset.live ?? "static",
    };
  }, atLoad);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // Scroll through the page so lazy media, scenes and reveals get their chance to shift layout.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.6) {
      scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 120));
    }
  });
  await page.waitForTimeout(500);
  result.clsScrolled = await page.evaluate(() => window.__vitals.cls);
  const issues = await page.evaluate(inspectPage);
  await context.close();
  return { ...result, errors, issues };
}

function parseArgs(argv) {
  const args = { base: "/", strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i] ?? "/";
    else if (argv[i] === "--strict") args.strict = true;
    else if (argv[i] === "--json") args.json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!args.base.startsWith("/")) args.base = `/${args.base}`;
  if (!args.base.endsWith("/")) args.base = `${args.base}/`;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(join(DIST, "index.html"))) throw new Error("dist/ is missing: run the build first");
  const { server, origin } = await serve(DIST, args.base);
  const browser = await chromium.launch({ executablePath: chromePath() });
  const rows = [];
  let failed = false;
  try {
    for (const path of ["", "en/"]) {
      for (const profile of Object.keys(PROFILES)) {
        for (const scheme of ["light", "dark"]) {
          const row = await audit(browser, `${origin}${args.base}${path}`, profile, scheme);
          rows.push({ page: `/${path}`, profile, scheme, ...row });
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  for (const r of rows) {
    const line =
      `${r.page.padEnd(5)} ${r.profile.padEnd(8)} ${r.scheme.padEnd(6)} ` +
      `FCP ${Math.round(r.fcp)} ms  LCP ${Math.round(r.lcp)} ms (${r.lcpElement})  CLS ${r.cls.toFixed(3)}/${r.clsScrolled.toFixed(3)} scrolled  ` +
      `HTML ${r.htmlKb.toFixed(1)} KB  JS first load ${r.jsFirstLoadKb.toFixed(1)} KB  JS total ${r.jsTotalKb.toFixed(1)} KB  hero ${r.hero}`;
    console.log(line);
    for (const message of [...r.errors.map((e) => `console error: ${e}`), ...r.issues]) console.log(`    ! ${message}`);
    if (r.issues.length > 0 || r.errors.length > 0 || r.jsFirstLoadKb > BUDGET.firstLoadJsKb) failed = true;
    if (args.strict && (r.lcp > BUDGET.lcpMs || r.clsScrolled > BUDGET.cls)) failed = true;
  }
  console.log(
    `budgets: first-load JS <= ${BUDGET.firstLoadJsKb} KB gzip, LCP <= ${BUDGET.lcpMs} ms${args.strict ? "" : " (reported)"}, CLS <= ${BUDGET.cls}`,
  );
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[audit] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  });
}
