// End-to-end test of the Chromium package built with `build.mjs --e2e` (dist-e2e/chrome).
//
// Loads the unpacked extension into a persistent Chromium profile (--headless=new; the old headless
// mode cannot run extensions), serves a static page over HTTP and drives the background through
// `globalThis.__swarmloomTest` in the service worker, because `action.onClicked` cannot be clicked
// headless. The hook calls the same handler as a toolbar click.
//
// Run: pnpm -F @swarmloom/extension test:e2e (builds first). Chromium: $SWARMLOOM_CHROME, else
// ~/bin/chromium, else Playwright's own build. Branded Chrome 137+ ignores --load-extension; use
// Chromium or Chrome for Testing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..", "..", "dist-e2e", "chrome");
const fixture = readFileSync(join(here, "page.html"));

/** A full first-screen build targets 8-12 s at 1x (decisions-v1 S09); leave room for slow runners. */
const BUILD_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 15_000;
const POLL_MS = 200;

/** @returns {string | undefined} */
function chromePath() {
  if (process.env.SWARMLOOM_CHROME) return process.env.SWARMLOOM_CHROME;
  const local = join(homedir(), "bin", "chromium");
  return existsSync(local) ? local : undefined;
}

/** @type {import("node:http").Server} */
let server;
/** @type {import("playwright").BrowserContext} */
let context;
/** @type {import("playwright").Worker} */
let worker;
let origin = "";
let profile = "";

/**
 * Runs `fn(arg)` in the service worker. `fn` is serialized, so it may only use its argument and
 * the worker's globals.
 * @template A, R
 * @param {(arg: A) => R | Promise<R>} fn
 * @param {A} arg
 * @returns {Promise<R>}
 */
function inWorker(fn, arg) {
  return worker.evaluate(fn, arg);
}

/**
 * Same as a toolbar click on the tab. `url` is what the click's activeTab grant would reveal.
 * @param {number} tabId
 * @param {string} [url]
 */
const toggle = (tabId, url) => inWorker(([id, href]) => globalThis.__swarmloomTest.toggle(id, href), [tabId, url]);
/** @param {number} tabId @returns {Promise<{ phase: string; error: string | null } | null>} */
const sessionState = (tabId) => inWorker((id) => globalThis.__swarmloomTest.state(id), tabId);

/**
 * Polls the session state of a tab until `done(state)` holds.
 * @param {number} tabId
 * @param {(state: { phase: string; error: string | null } | null) => boolean} done
 * @param {number} timeout
 */
async function waitForState(tabId, done, timeout) {
  const deadline = performance.now() + timeout;
  let state = await sessionState(tabId);
  while (!done(state)) {
    if (performance.now() > deadline) throw new Error(`timed out; last session state ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    state = await sessionState(tabId);
  }
  return state;
}

/**
 * Opens `url` in a new foreground tab and returns the page and its extension tab id.
 * @param {string} url
 */
async function openTab(url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  // Browser pages (chrome://) hide their URL from host permissions; the foreground tab is the one.
  const tabId = await inWorker(async (href) => {
    const tabs = await chrome.tabs.query({});
    return (tabs.find((t) => t.url === href) ?? tabs.find((t) => t.active && t.url === undefined))?.id;
  }, page.url());
  assert.equal(typeof tabId, "number", `no tab found for ${url}`);
  return { page, tabId: /** @type {number} */ (tabId) };
}

/** @param {import("playwright").Page} page */
const pageHtml = (page) => page.evaluate(() => document.documentElement.outerHTML);

before(async () => {
  assert.ok(
    existsSync(join(extensionDir, "manifest.json")),
    `missing ${extensionDir}; run "pnpm -F @swarmloom/extension build:e2e" first`,
  );
  server = createServer((req, res) => {
    if (req.method !== "GET" || !req.url?.startsWith("/page")) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;

  profile = mkdtempSync(join(tmpdir(), "swarmloom-e2e-"));
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath(),
    // Playwright's own headless flag selects the old mode; ask for the new one explicitly.
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 1280, height: 800 },
  });
  worker =
    context.serviceWorkers().find((w) => w.url().endsWith("/background.js")) ??
    (await context.waitForEvent("serviceworker", { timeout: STEP_TIMEOUT_MS }));
  const hooked = await inWorker(() => typeof globalThis.__swarmloomTest?.toggle === "function", undefined);
  assert.ok(hooked, "the service worker has no __swarmloomTest hook; is this an --e2e build?");
});

after(async () => {
  await context?.close();
  await new Promise((resolve) => (server ? server.close(() => resolve(undefined)) : resolve(undefined)));
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test("explains a restricted page with a badge and a notice tab offering three next steps", async () => {
  const { page, tabId } = await openTab("chrome://version/");
  const noticeOpened = context.waitForEvent("page", {
    predicate: (p) => p.url().includes("/notice.html"),
    timeout: STEP_TIMEOUT_MS,
  });
  await toggle(tabId, page.url());
  const notice = await noticeOpened;
  assert.equal(new URL(notice.url()).searchParams.get("reason"), "browser-page");
  assert.equal(await inWorker((id) => globalThis.__swarmloomTest.badge(id), tabId), "!");

  await notice.waitForLoadState();
  for (const id of ["open-studio", "import", "copy"]) {
    const action = notice.locator(`#${id}`);
    assert.ok(await action.isVisible(), `#${id} is visible`);
    assert.notEqual((await action.textContent())?.trim(), "", `#${id} has a label`);
  }
  assert.notEqual((await notice.locator("#reason").textContent())?.trim(), "");
  await notice.close();
  await page.close();
});

test("a second toggle stops the swarm and leaves the page exactly as it was", async () => {
  const { page, tabId } = await openTab(`${origin}/page?toggle`);
  const before = await pageHtml(page);

  await toggle(tabId);
  assert.notEqual(await sessionState(tabId), null, "a session started");
  assert.ok(
    (await page.locator("swarmloom-ui").count()) > 0 || (await pageHtml(page)) !== before,
    "the overlay is mounted",
  );

  await toggle(tabId);
  assert.equal(await sessionState(tabId), null, "the session ended");
  assert.equal(await pageHtml(page), before);
  await page.close();
});

test("rebuilds a page to done, goes live and restores the real page", async () => {
  const { page, tabId } = await openTab(`${origin}/page?full`);
  const before = await pageHtml(page);

  await toggle(tabId);
  const state = await waitForState(
    tabId,
    (s) => s === null || s.phase === "done" || s.phase === "error" || s.phase === "closed",
    BUILD_TIMEOUT_MS,
  );
  assert.equal(
    state?.phase,
    "done",
    `expected the build to finish; session state ${JSON.stringify(state)} (an error of "not implemented yet" means core or snapshot-dom has not landed)`,
  );

  assert.equal(await inWorker((id) => globalThis.__swarmloomTest.goLive(id), tabId), true, "go live was pressed");
  await waitForState(tabId, (s) => s === null, STEP_TIMEOUT_MS);
  // Go live may fade out first; the page must end up byte-identical.
  await page.waitForFunction(() => document.querySelector("swarmloom-ui") === null, undefined, {
    timeout: STEP_TIMEOUT_MS,
  });
  assert.equal(await pageHtml(page), before);
  await page.close();
});
