/**
 * The loader in a real browser: a page without CSP gets the hosted bundle, a page with a strict
 * CSP hands its copy to a (fake) Studio tab.
 *
 * Each page is a srcdoc iframe. Its own module script imports the loader before any CSP applies,
 * which stands in for the browser running a bookmark: bookmarklets run whatever the page policy,
 * only what they load is subject to it. The loader code is the unminified source; the size and
 * syntax of the minified `javascript:` URL are covered by loader.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { LoaderConfig } from "../src/loader";
import { type BookmarkletHandle, GLOBAL_KEY, parsePagePayload, SCRIPT_ID } from "../src/protocol";
import type { FakePlayerRecord } from "./fixtures/fake-bundle";

// Literal `new URL("...", import.meta.url)` on purpose: Vite rewrites it to the served path, which
// the dev server also serves for HTML (unlike the file-system path in this module's URL).
const LOADER = new URL("../src/loader.ts", import.meta.url).href;
const FAKE_BUNDLE = new URL("./fixtures/fake-bundle.ts", import.meta.url).href;
const REAL_BUNDLE = new URL("../src/swarm.ts", import.meta.url).href;
const FAKE_STUDIO = new URL("./fixtures/studio.html?from=bookmarklet", import.meta.url).href;

/** Globals the test page defines (see {@link openPage}) or the bundle registers. */
interface PageWindow extends Window {
  runBookmarklet?: (config: LoaderConfig) => void;
  openCalls?: number;
  [GLOBAL_KEY]?: BookmarkletHandle;
}

/** Message the fake Studio relays over the test channel (see fixtures/studio.html). */
type StudioReport =
  | { kind: "open"; search: string; hasOpener: boolean }
  | { kind: "page"; origin: string; data: unknown };

const frames: HTMLIFrameElement[] = [];
const channels: BroadcastChannel[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  for (const channel of channels.splice(0)) channel.close();
});

/**
 * Opens `body` in an iframe whose window has `runBookmarklet(config)` (the loader, bound to that
 * window) and counts `window.open` calls. The helpers are defined by the page's own module, so
 * the popup's opener is the page, as with a real bookmarklet.
 */
async function openPage(body: string): Promise<PageWindow> {
  const frame = document.createElement("iframe");
  frame.srcdoc = `<!doctype html><html lang="en"><head><title>Test page</title><style id="cssom"></style>
<script type="module">
import { runLoader } from ${JSON.stringify(LOADER)};
const open = window.open.bind(window);
window.openCalls = 0;
window.open = (...args) => (window.openCalls++, open(...args));
window.runBookmarklet = (config) => runLoader(window, document, config);
</script></head><body>${body}</body></html>`;
  document.body.append(frame);
  frames.push(frame);
  const win = frame.contentWindow as PageWindow;
  await expect.poll(() => typeof win.runBookmarklet, { timeout: 15_000 }).toBe("function");
  return win;
}

/** Collects what the fake Studio reports. */
function listenToStudio(): StudioReport[] {
  const reports: StudioReport[] = [];
  const channel = new BroadcastChannel("swarmloom-bm-test");
  channel.onmessage = (event: MessageEvent<StudioReport>) => reports.push(event.data);
  channels.push(channel);
  return reports;
}

const config = (bundleUrl: string, options = ""): LoaderConfig => ({
  bundleUrl,
  studioUrl: FAKE_STUDIO,
  options,
  timeout: 15_000,
});

describe("bookmarklet loader in Chromium", () => {
  it("injects the bundle on a page without CSP, which rebuilds in overlay mode and toggles off", async () => {
    const win = await openPage("<h1>Plain page</h1>");
    win.runBookmarklet?.(config(FAKE_BUNDLE, "speed=2&sound=0"));

    await expect.poll(() => win[GLOBAL_KEY]?.state, { timeout: 15_000 }).toBe("running");
    const players = (win as PageWindow & { __bmTest?: { players: FakePlayerRecord[] } }).__bmTest?.players ?? [];
    expect(players).toHaveLength(1);
    expect(players[0]?.options).toMatchObject({ mode: "overlay", controls: true, speed: 2, sound: false });
    expect(win.document.getElementById(SCRIPT_ID)).toBeNull();
    expect(win.document.querySelector("[data-fake-overlay]")).not.toBeNull();

    // The second click reaches the running bundle and stops the rebuild.
    win.runBookmarklet?.(config(FAKE_BUNDLE));
    expect(win[GLOBAL_KEY]?.state).toBe("idle");
    expect(players[0]?.destroyed).toBe(true);
    expect(win.document.querySelector("[data-fake-overlay]")).toBeNull();
    expect(win.openCalls).toBe(0);
  });

  it("loads and boots the real hosted bundle", async () => {
    const win = await openPage("<h1>Real bundle</h1><p>Some text.</p>");
    win.runBookmarklet?.(config(REAL_BUNDLE));

    // "failed" (with the in-page notice) until the snapshotter and engine land, "running" after.
    await expect
      .poll(() => win[GLOBAL_KEY]?.state, { timeout: 30_000 })
      .toSatisfy((state) => state === "running" || state === "failed");
    expect(win.document.getElementById(SCRIPT_ID)).toBeNull();
    expect(win.openCalls).toBe(0);
  });

  it("hands the page to the Studio once when a strict CSP blocks the bundle", async () => {
    const win = await openPage(
      '<main><h1>Strict page</h1><img src="img/logo.png" alt=""><input type="password" value="hunter2"></main>',
    );
    const doc = win.document;
    (doc.getElementById("cssom") as HTMLStyleElement).sheet?.insertRule(".from-cssom { color: red }");
    const csp = doc.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "script-src 'none'";
    doc.head.append(csp);
    const reports = listenToStudio();

    win.runBookmarklet?.(config(FAKE_BUNDLE));

    await expect.poll(() => reports.find((r) => r.kind === "page"), { timeout: 15_000 }).toBeTruthy();
    const opened = reports.find((r) => r.kind === "open");
    expect(opened).toEqual({ kind: "open", search: "?from=bookmarklet", hasOpener: true });
    const page = reports.find((r) => r.kind === "page");
    if (page?.kind !== "page") throw new Error("no page report");
    // Posted with the Studio origin as targetOrigin; the Studio sees the page's origin.
    expect(page.origin).toBe(location.origin);
    const parsed = parsePagePayload(page.data);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.payload.reason).toBe("blocked");
    expect(parsed.payload.viewport.w).toBe(win.innerWidth);
    const html = parsed.payload.html;
    // The srcdoc base URL is this module's URL, whose query has "&": escaped in the attribute.
    expect(html.startsWith(`<!DOCTYPE html><base href="${doc.baseURI.replaceAll("&", "&amp;")}">`)).toBe(true);
    expect(html).toContain("Strict page");
    expect(html).toContain(".from-cssom");
    expect(html).not.toContain("hunter2");

    // Violation and error event both fire; only one Studio tab opens, and the bundle never ran.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(win.openCalls).toBe(1);
    expect(reports.filter((r) => r.kind === "open")).toHaveLength(1);
    expect(win[GLOBAL_KEY]).toBeUndefined();
  });
});
