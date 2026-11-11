/// <reference types="@vitest/browser-playwright" />
import { afterAll, beforeAll, expect, it } from "vitest";
import { cdp } from "vitest/browser";
import { exportVideo } from "../src/browser/index";

/**
 * A blue and a grey box; red with reduced motion, green on a high-density screen (the CLI emulates no
 * preference and renders at one device pixel per CSS px).
 */
const PAGE =
  "<!doctype html><html><head><style>body{margin:0;background:#fff}" +
  ".box{width:100px;height:40px;background:rgb(0,0,255)}.dense{background:rgb(128,128,128)}" +
  "@media (prefers-reduced-motion: reduce){.box{background:rgb(255,0,0)}}" +
  "@media (min-resolution: 2dppx){.dense{background:rgb(0,160,0)}}" +
  '</style></head><body><div class="box"></div><div class="box dense"></div></body></html>';

/** What the export frame's scripts and the HTML adapter's page see without a pinned feature. */
const PINNED = "false rgb(0, 0, 255) rgb(128, 128, 128)";

/** Overrides the device scale factor and keeps the page's viewport. */
function metrics(deviceScaleFactor: number): Promise<unknown> {
  const top = window.top ?? window;
  return cdp().send("Emulation.setDeviceMetricsOverride", {
    width: top.innerWidth,
    height: top.innerHeight,
    deviceScaleFactor,
    mobile: false,
  });
}

/** Host settings the export must not follow, each set and reset through the DevTools protocol. */
const HOSTS = [
  {
    name: "reduced motion",
    query: "(prefers-reduced-motion: reduce)",
    set: () =>
      cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }),
    reset: () => cdp().send("Emulation.setEmulatedMedia", { features: [] }),
    samePixels: true,
  },
  {
    name: "a 2x screen",
    query: "(min-resolution: 2dppx)",
    set: () => metrics(2),
    reset: () => metrics(1),
    // Chromium anti-aliases canvas text (the overlay's size labels) for the screen's density, so
    // only the styles are compared.
    samePixels: false,
  },
];

let container: HTMLElement;
let observer: MutationObserver;
let plain: string[];

/** Exports the page; also reports what the frame's `matchMedia` and the page's styles say mid-export. */
async function exportPage(): Promise<{ hashes: string[]; seen: string | null }> {
  let seen: string | null = null;
  const result = await exportVideo({
    input: { name: "media.html", type: "text/html", text: PAGE },
    width: 160,
    height: 90,
    fps: 5,
    settings: { sound: false, live: false, tail: 400 },
    container,
    onProgress: () => {
      const win = container.querySelector("iframe")?.contentWindow;
      const page = win?.document.querySelector("iframe")?.contentDocument;
      const [box, dense] = Array.from(page?.querySelectorAll(".box") ?? []);
      if (seen !== null || !win || !page?.defaultView || !box || !dense) return;
      const color = (el: Element) => page.defaultView?.getComputedStyle(el).backgroundColor;
      seen = `${win.matchMedia("(prefers-reduced-motion: reduce), (min-resolution: 2dppx)").matches} ${color(box)} ${color(dense)}`;
    },
  });
  return { hashes: result.frameSha256, seen };
}

beforeAll(async () => {
  container = document.createElement("div");
  document.body.append(container);
  // Vitest's browser runner wraps dynamic imports through a global of the test page; the export
  // frame is a page of its own, so it gets a pass-through.
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const win = (node as HTMLIFrameElement).contentWindow as (Window & Record<string, unknown>) | null;
        if (win) win.__vitest_browser_runner__ = { wrapDynamicImport: (load: () => unknown) => load() };
      }
    }
  });
  observer.observe(container, { childList: true });
  const first = await exportPage();
  expect(first.seen).toBe(PINNED);
  plain = first.hashes;
}, 120_000);

afterAll(() => {
  observer.disconnect();
  container.remove();
});

it.each(HOSTS)("exports as the CLI does on a host with $name", { timeout: 120_000 }, async (host) => {
  await host.set();
  try {
    expect(matchMedia(host.query).matches).toBe(true);
    const exported = await exportPage();
    expect(exported.seen).toBe(PINNED);
    if (host.samePixels) expect(exported.hashes).toEqual(plain);
  } finally {
    await host.reset();
  }
});
