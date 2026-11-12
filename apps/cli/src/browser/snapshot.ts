import type { Blueprint } from "@swarmloom/core";
import type { BrowserContext, Page } from "playwright-core";
import { briefMessage, CliError, errorMessage, RenderError } from "../errors";
import { guard } from "../util/async";
import { freezePageAnimations, LOOP_PHASE } from "./freeze";
import type { PageLog } from "./launch";

/** Global installed by dist/snapshot.js (src/inject/snapshot.ts). */
export const SNAPSHOT_GLOBAL = "__swarmloomSnapshot";

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
 * Opens `url` in a new page of `context`, waits for it to settle, freezes its animations (see
 * {@link freezePageAnimations}), injects the snapshot script and captures the page as a Blueprint
 * (images inlined, lazy content pre-scrolled, a viewport screenshot supplied for WebGL canvases,
 * videos and cross-origin frames). The page is closed afterwards.
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
    await page.evaluate(() => document.fonts?.ready.then(() => undefined)).catch(() => {});
    // Freeze before the screenshot: it stands in for canvases and videos, so it must show the same pose.
    await page.evaluate(freezePageAnimations, LOOP_PHASE).catch(() => {});

    const cdp = await context.newCDPSession(page);
    const shot = (await cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    await cdp.detach().catch(() => {});
    const view = await page.evaluate(() => ({ x: scrollX, y: scrollY, dpr: devicePixelRatio, title: document.title }));

    try {
      // Not a <script> element: a page served with `script-src 'none'` must still accept it.
      await page.evaluate(`${opts.bundle}\n;undefined`);
    } catch (error) {
      throw fail("Could not inject the snapshot script", error);
    }
    const snapshotOptions = {
      origin: "document",
      source: {
        type: "dom",
        ...(opts.source ?? { url: page.url() }),
        ...(view.title ? { title: view.title } : {}),
      },
      prescroll: true,
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
