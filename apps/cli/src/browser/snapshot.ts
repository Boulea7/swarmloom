import type { Blueprint } from "@swarmloom/core";
import type { BrowserContext, Page } from "playwright-core";
import { briefMessage, CliError, errorMessage, InterruptedError, RenderError } from "../errors";
import { guard } from "../util/async";
import { catchEndEvents, END_EVENTS_GLOBAL, freezePageAnimations, freezePageVideos, LOOP_PHASE } from "./freeze";
import type { PageLog } from "./launch";

/** Global installed by dist/snapshot.js (src/inject/snapshot.ts). */
export const SNAPSHOT_GLOBAL = "__swarmloomSnapshot";

/** Longest wait for the page's videos to load their metadata and reach their frozen frame. */
const VIDEO_FREEZE_TIMEOUT_MS = 3000;
/** Longest wait for one call of the animation freeze, which takes at most about 2 s on its own. */
const ANIMATION_FREEZE_TIMEOUT_MS = 5000;

export interface PageSnapshotOptions {
  url: string;
  /** Source of dist/snapshot.js. */
  bundle: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Attaches diagnostics to the new page. */
  watch?(page: Page): PageLog;
  /**
   * Source metadata for the blueprint. Default: { type: "dom", url: <page URL>, title }.
   * Local files pass their name instead of the temporary localhost URL they were served from.
   */
  source?: { name?: string; url?: string };
}

export interface PageSnapshot {
  blueprint: Blueprint;
  /** HTTP status of the main document (0 for file and data URLs). */
  status: number;
}

/**
 * Runs in the captured page: the snapshot script's scroll pass (lazy content, reveal-on-scroll), then
 * two painted frames, so observers of the restored scroll position have run and the transitions they
 * start exist when the page is frozen. Self-contained: Playwright sends its source to the page.
 */
async function prescrollPage(name: string): Promise<void> {
  type Api = { prescroll?(doc: Document): Promise<void> };
  const api = (globalThis as unknown as Record<string, Api | undefined>)[name];
  if (typeof api?.prescroll !== "function") throw new Error("snapshot script did not initialise");
  await api.prescroll(document);
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
      setTimeout(resolve, 200);
    });
  }
}

/**
 * Waits at most `ms` for a best-effort step in the page. A step that fails or times out is skipped, so
 * a page that never answers is captured as it is; only an interruption is passed on.
 */
async function bestEffort(step: Promise<unknown>, what: string, ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await guard(step, what, ms, signal);
  } catch (error) {
    if (error instanceof InterruptedError) throw error;
  }
}

/**
 * Checks the shape of a blueprint produced in the page (untrusted JSON).
 * @throws RenderError when it is not a version 1 blueprint.
 */
export function parseBlueprint(json: string): Blueprint {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new RenderError(`The snapshot is not valid JSON: ${errorMessage(error)}`);
  }
  const bp = value as Partial<Blueprint> | null;
  const sized = bp?.size && Number.isFinite(bp.size.w) && Number.isFinite(bp.size.h);
  if (bp?.version !== 1 || !Array.isArray(bp.layers) || !sized) {
    throw new RenderError("The snapshot did not return a version 1 blueprint");
  }
  return bp as Blueprint;
}

/**
 * Opens `url` in a new page of `context`, waits for it to settle, injects the snapshot script, scrolls
 * through the page once so lazy content loads, freezes its animations and videos (see
 * {@link freezePageAnimations} and {@link freezePageVideos}) and captures the page as a Blueprint
 * (images inlined, a viewport screenshot supplied for WebGL canvases, videos and cross-origin frames).
 * The page is closed afterwards. The freeze runs after the scroll pass, so transitions that pass
 * starts (reveal-on-scroll cards) are read in their end state instead of wherever real time had them.
 *
 * The snapshot script is evaluated over DevTools, so it runs even where the page's CSP blocks scripts.
 * @param context Create it with bypassCSP for web pages, so their CSP does not hold back the capture.
 * @throws RenderError when the page cannot be loaded or the snapshot fails.
 */
export async function snapshotPage(context: BrowserContext, opts: PageSnapshotOptions): Promise<PageSnapshot> {
  const page = await context.newPage();
  const log = opts.watch?.(page);
  const fail = (what: string, error: unknown) => {
    const recent = log?.recent() ?? [];
    const details = recent.length ? `\nPage errors:\n  ${recent.join("\n  ")}` : "";
    return new RenderError(`${what}: ${briefMessage(error)}${details}`, undefined, { cause: error });
  };
  try {
    // Before the page's scripts, so the freeze's end-event filter runs ahead of all their listeners.
    await page.addInitScript(catchEndEvents, END_EVENTS_GLOBAL);
    let status = 0;
    try {
      const response = await guard(
        page.goto(opts.url, { waitUntil: "load", timeout: opts.timeoutMs }),
        `Loading ${opts.url}`,
        opts.timeoutMs + 1000,
        opts.signal,
      );
      status = response?.status() ?? 0;
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw fail(`Could not load ${opts.url}`, error);
    }
    // Best effort: late XHR content and web fonts. Pages that never go idle are captured as they are.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    // Every wait on the page below is bounded and interruptible: page scripts can stall a promise or
    // the event loop, and the helpers that run in the page trust its globals (setTimeout, getAnimations).
    const fonts = page.evaluate(() => document.fonts?.ready.then(() => undefined));
    await bestEffort(fonts, "Waiting for web fonts", opts.timeoutMs, opts.signal);

    try {
      // Not a <script> element: a page served with `script-src 'none'` must still accept it.
      const inject = page.evaluate(`${opts.bundle}\n;undefined`);
      await guard(inject, "Injecting the snapshot script", opts.timeoutMs, opts.signal);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw fail("Could not inject the snapshot script", error);
    }
    try {
      await guard(page.evaluate(prescrollPage, SNAPSHOT_GLOBAL), "Pre-scrolling the page", opts.timeoutMs, opts.signal);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw fail("Pre-scrolling the page failed", error);
    }
    // After the scroll pass, which starts reveal transitions, and before the screenshot: it stands in
    // for canvases and videos, so it must show the same pose. Again after the videos, whose pauses fire
    // `pause` events that may start new animations. Best effort: a page that stops its own timers and
    // frames is captured as it is.
    const freezeAnimations = () => {
      const freeze = page.evaluate(freezePageAnimations, { phase: LOOP_PHASE, endEvents: END_EVENTS_GLOBAL });
      return bestEffort(freeze, "Freezing animations", ANIMATION_FREEZE_TIMEOUT_MS, opts.signal);
    };
    await freezeAnimations();
    const videos = page.evaluate(freezePageVideos, { phase: LOOP_PHASE, timeoutMs: VIDEO_FREEZE_TIMEOUT_MS });
    await bestEffort(videos, "Freezing videos", opts.timeoutMs, opts.signal);
    await freezeAnimations();

    let shot: { data: string };
    let view: { x: number; y: number; dpr: number; title: string };
    try {
      const cdp = await guard(context.newCDPSession(page), "Page screenshot", opts.timeoutMs, opts.signal);
      const capture = cdp.send("Page.captureScreenshot", { format: "png" }) as Promise<{ data: string }>;
      shot = await guard(capture, "Page screenshot", opts.timeoutMs, opts.signal);
      await cdp.detach().catch(() => {});
      const read = page.evaluate(() => ({ x: scrollX, y: scrollY, dpr: devicePixelRatio, title: document.title }));
      view = await guard(read, "Reading the page view", opts.timeoutMs, opts.signal);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw fail("Page screenshot failed", error);
    }
    const snapshotOptions = {
      origin: "document",
      source: {
        type: "dom",
        ...(opts.source ?? { url: page.url() }),
        ...(view.title ? { title: view.title } : {}),
      },
      // Done above, before the freeze.
      prescroll: false,
      inlineImages: true,
      screenshot: { src: `data:image/png;base64,${shot.data}`, scrollX: view.x, scrollY: view.y, dpr: view.dpr },
    };
    let json: string;
    try {
      json = await guard(
        page.evaluate(
          async ({ name, options }) => {
            type Api = { snapshot(root: Document, o: unknown): Promise<unknown> };
            const api = (globalThis as unknown as Record<string, Api | undefined>)[name];
            if (!api) throw new Error("snapshot script did not initialise");
            return JSON.stringify(await api.snapshot(document, options));
          },
          { name: SNAPSHOT_GLOBAL, options: snapshotOptions },
        ),
        "Page snapshot",
        opts.timeoutMs,
        opts.signal,
      );
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw fail("Page snapshot failed", error);
    }
    return { blueprint: parseBlueprint(json), status };
  } finally {
    await page.close().catch(() => {});
  }
}
