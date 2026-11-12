/// <reference types="@vitest/browser-playwright" />
import { afterAll, beforeAll, expect, it } from "vitest";
import { cdp, commands, server } from "vitest/browser";
import { exportVideo } from "../src/browser/index";

/** Media preferences Playwright emulates in every engine (the `emulateMedia` command of vitest.config.ts). */
interface EmulatedMedia {
  colorScheme?: "light" | "dark";
  reducedMotion?: "no-preference" | "reduce";
  forcedColors?: "none" | "active";
}

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia(media: EmulatedMedia): Promise<void>;
  }
}

/**
 * A blue and a grey box; black in a dark color scheme, red with reduced motion, on a wide-gamut or
 * touch screen or on a screen wider than the export, green on a high-density screen, recoloured in
 * forced colors (the CLI emulates a light scheme for `theme: "auto"`, no motion preference, no forced
 * colors, one device pixel per CSS px, an sRGB screen the size of the viewport and a mouse).
 */
const PAGE =
  "<!doctype html><html><head><style>body{margin:0;background:#fff}" +
  ".box{width:100px;height:40px;background:rgb(0,0,255)}.dense{background:rgb(128,128,128)}" +
  "@media (prefers-color-scheme: dark){.box{background:rgb(0,0,0)}}" +
  "@media (prefers-reduced-motion: reduce), (color-gamut: p3), (pointer: coarse), (hover: none), " +
  "(min-device-width: 161px){.box{background:rgb(255,0,0)}}" +
  "@media (min-resolution: 2dppx){.dense{background:rgb(0,160,0)}}" +
  '</style></head><body><div class="box"></div><div class="box dense"></div></body></html>';

/**
 * What the export frame's scripts, its default text colour and the HTML adapter's page show without
 * a pinned feature.
 */
const PINNED = "false rgb(0, 0, 0) rgb(0, 0, 255) rgb(128, 128, 128)";

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

/** A host setting: `query` holds once it is set; the export's pixels must stay the same if `samePixels`. */
interface Host {
  name: string;
  query: string;
  set(): Promise<unknown>;
  reset(): Promise<unknown>;
  samePixels: boolean;
}

/** Playwright's defaults, which the test page has outside these cases. */
const DEFAULT_MEDIA: EmulatedMedia = { colorScheme: "light", reducedMotion: "no-preference", forcedColors: "none" };
const resetMedia = () => commands.emulateMedia(DEFAULT_MEDIA);

/** Host preferences the export must not follow, set and reset in every engine. */
const PREFERENCES: Host[] = [
  {
    name: "a dark color scheme",
    query: "(prefers-color-scheme: dark)",
    set: () => commands.emulateMedia({ colorScheme: "dark" }),
    reset: resetMedia,
    samePixels: true,
  },
  {
    name: "reduced motion",
    query: "(prefers-reduced-motion: reduce)",
    set: () => commands.emulateMedia({ reducedMotion: "reduce" }),
    reset: resetMedia,
    samePixels: true,
  },
  {
    name: "forced colors",
    query: "(forced-colors: active)",
    set: () => commands.emulateMedia({ forcedColors: "active" }),
    reset: resetMedia,
    samePixels: true,
  },
];

/** Host screens the export must not follow, set and reset through Chromium's DevTools protocol. */
const SCREENS: Host[] = [
  {
    name: "a wide-gamut touch screen",
    query: "(color-gamut: p3) and (pointer: coarse)",
    set: async () => {
      await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "color-gamut", value: "p3" }] });
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    },
    reset: async () => {
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    },
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
let plain: string[];
let observer: MutationObserver;

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
    hashFrames: true,
    onProgress: () => {
      const win = container.querySelector("iframe")?.contentWindow;
      const page = win?.document.querySelector("iframe")?.contentDocument;
      const [box, dense] = Array.from(page?.querySelectorAll(".box") ?? []);
      if (seen !== null || !win || !page?.defaultView || !box || !dense) return;
      const color = (el: Element) => page.defaultView?.getComputedStyle(el).backgroundColor;
      const pinned =
        "(prefers-color-scheme: dark), (prefers-reduced-motion: reduce), (forced-colors: active), (min-resolution: 2dppx), " +
        "(color-gamut: p3), (pointer: coarse), (hover: none), (min-device-width: 161px)";
      const text = win.getComputedStyle(win.document.body).color;
      seen = `${win.matchMedia(pinned).matches} ${text} ${color(box)} ${color(dense)}`;
    },
  });
  return { hashes: result.frameSha256, seen };
}

function passThroughImports(frame: HTMLIFrameElement): void {
  const win = frame.contentWindow as (Window & Record<string, unknown>) | null;
  if (win) win.__vitest_browser_runner__ = { wrapDynamicImport: (load: () => unknown) => load() };
}

function onFrameLoad(event: Event): void {
  if (event.target instanceof HTMLIFrameElement) passThroughImports(event.target);
}

beforeAll(async () => {
  container = document.createElement("div");
  document.body.append(container);
  // Vitest's browser runner wraps dynamic imports through a global of the test page; the export
  // frame is a page of its own, so it gets a pass-through: when added, and again on load in the
  // capture phase, before the exporter's listener on the frame, as WebKit gives the srcdoc page a
  // window other than the frame's first one.
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement) passThroughImports(node);
      }
    }
  });
  observer.observe(container, { childList: true });
  container.addEventListener("load", onFrameLoad, true);
  const first = await exportPage();
  expect(first.seen).toBe(PINNED);
  plain = first.hashes;
}, 120_000);

afterAll(() => {
  observer.disconnect();
  container.removeEventListener("load", onFrameLoad, true);
  container.remove();
});

/** Exports on a host with `host`'s setting, which must change nothing the export shows. */
async function exportsAsTheCli(host: Host): Promise<void> {
  await host.set();
  try {
    expect(matchMedia(host.query).matches).toBe(true);
    const exported = await exportPage();
    expect(exported.seen).toBe(PINNED);
    if (host.samePixels) expect(exported.hashes).toEqual(plain);
  } finally {
    await host.reset();
  }
}

it.each(PREFERENCES)("exports as the CLI does on a host with $name", { timeout: 120_000 }, exportsAsTheCli);

it.runIf(server.browser === "chromium").each(SCREENS)(
  "exports as the CLI does on a host with $name",
  { timeout: 120_000 },
  exportsAsTheCli,
);
