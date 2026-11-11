import type { BrowserExportOptions, BrowserExportResult } from "@swarmloom/export/browser";
import { FORMAT_META as REGISTRY } from "@swarmloom/formats/meta";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../src/styles/studio.css";
import { mountStudio, type StudioApp } from "../src/app";
import {
  type ExampleEntry,
  type ExampleManifest,
  entriesForLocale,
  isHousekeeping,
  planExamples,
  sortEntries,
} from "../src/examples/manifest";
import { availableFormats } from "../src/formats-meta";
import type { BrowserExporter } from "../src/services";
import { fakeServices } from "./fakes";

/** Every file of the repository's examples folder, as the build would see it (paths only). */
const FILES = Object.keys(import.meta.glob("../../../examples/**/*"))
  .map((p) => p.replace(/^(\.\.\/)+examples\//, ""))
  .filter((p) => !isHousekeeping(p))
  .sort();

const MANIFEST: ExampleManifest = {
  version: 1,
  entries: sortEntries(
    planExamples(FILES).map(
      (c): ExampleEntry => ({ id: c.id, path: c.path, format: c.format, title: c.path, size: 1024, group: c.group }),
    ),
  ),
};

const EXAMPLES_BASE = new URL("/examples/", location.origin).href;

// Like main.ts: the bundled registry's ids, so optional formats it provides (Lottie) show.
const REGISTRY_IDS = REGISTRY.map((meta) => meta.id);

let app: StudioApp | null = null;

async function mount(search = "", seekable = false, exporter?: BrowserExporter) {
  history.replaceState(null, "", `${location.pathname}${search}`);
  const root = document.createElement("div");
  document.body.append(root);
  const fake = fakeServices({ manifest: MANIFEST, examplesBase: EXAMPLES_BASE, seekable });
  fake.services.formats = REGISTRY_IDS;
  if (exporter) fake.services.loadExporter = async () => exporter;
  app = await mountStudio(root, fake.services);
  return { root, ...fake };
}

async function until<T>(probe: () => T | null | undefined, timeoutMs = 4000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (performance.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Opens the export dialog of a loaded example and returns its in-page export controls. */
async function openExport(root: HTMLElement) {
  (await until(() => root.querySelector<HTMLButtonElement>('.appbar [aria-keyshortcuts="E"]:enabled'))).click();
  const dialog = await until(() => root.querySelector<HTMLDialogElement>("dialog.panel-export[open]"));
  const [start, cancel, download] = dialog.querySelectorAll<HTMLElement>(".export-actions > *");
  const status = dialog.querySelector<HTMLElement>(".export-status");
  if (!start || !cancel || !download || !status) throw new Error("no in-page export");
  return { dialog, start, cancel, download: download as HTMLAnchorElement, status };
}

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.replaceChildren();
  history.replaceState(null, "", location.pathname);
});

describe("Studio in a browser", () => {
  it("renders home with the open actions and one card per repository example", async () => {
    const { root } = await mount();
    expect(document.documentElement.dataset.view).toBe("home");
    expect(root.querySelector("h1")?.textContent).not.toBe("");
    expect(root.querySelector(".dropzone")).not.toBeNull();
    expect(root.querySelector(".url-form input")).not.toBeNull();

    expect(MANIFEST.entries.length).toBeGreaterThanOrEqual(4);
    const ids = [...root.querySelectorAll<HTMLAnchorElement>(".card")].map((card) => card.dataset.example);
    // One card per example group: language and file-type variants share a card.
    expect(ids).toEqual(entriesForLocale(MANIFEST, "en", availableFormats(REGISTRY_IDS)).map((e) => e.id));
    // Optional formats the registry provides get their card (Lottie is hidden without services.formats).
    expect(ids).toContain("lottie-shuttle-loop");
    expect(root.querySelector('.card[data-example="epub-loom-notes"] .card-sub')?.textContent).toMatch(/^EPUB/);
  });

  it("opens an example into the inline stage", async () => {
    const { root, log } = await mount();
    const card = root.querySelector<HTMLAnchorElement>('.card[data-example="svg-chart"]');
    expect(card).not.toBeNull();
    card?.click();

    const stage = await until(() => root.querySelector<HTMLElement>(".stage-host [data-fake-stage]"));
    expect(document.documentElement.dataset.view).toBe("player");
    expect(new URL(location.href).searchParams.get("example")).toBe("svg-chart");
    expect(stage.dataset.fakeStage).toBe("svg");
    expect(log.loads[0]?.name).toBe("chart.svg");
    expect(log.loads[0]?.text).toContain("<svg");
    expect(log.contexts[0]?.network).toBe("https");
    expect(log.players[0]).toMatchObject({ mode: "inline", host: root.querySelector(".stage-host") });
    // This player cannot seek: the footer keeps the plain progress bar.
    expect(root.querySelector<HTMLElement>(".progress")?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".scrub-range")?.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>(".play-big")?.click();
    expect(log.calls).toContain("play");
  });

  it("previews a scrubber drag and seeks once, to where it is let go", async () => {
    const { root, log } = await mount("?example=svg-chart", true);
    (await until(() => root.querySelector<HTMLButtonElement>(".play-big"))).click();
    const seeker = root.querySelector<HTMLInputElement>(".scrub-range");
    if (!seeker || seeker.hidden) throw new Error("no seek slider");
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const seeks = () => log.calls.filter((c) => c.startsWith("seek:"));
    // A seek back replays the build from the start: dragging only moves the thumb.
    for (const value of ["100", "200", "300"]) {
      seeker.value = value;
      seeker.dispatchEvent(new Event("input", { bubbles: true }));
      await frame();
    }
    expect(seeks()).toEqual([]);
    expect([seeker.value, seeker.getAttribute("aria-valuetext")]).toEqual(["300", "30%"]);
    // Letting go (pointerup anywhere, then change on the slider) seeks once.
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    seeker.dispatchEvent(new Event("change", { bubbles: true }));
    await frame();
    expect(seeks()).toEqual(["seek:3600"]); // 300 / 1000 of the fake's 12 s plan
  });

  it("enables the seek slider once the build runs; End seeks to the end", async () => {
    const { root, log } = await mount("?example=svg-chart", true);
    const play = await until(() => root.querySelector<HTMLButtonElement>(".play-big"));
    const seeker = root.querySelector<HTMLInputElement>(".scrub-range");
    expect([seeker?.hidden, seeker?.disabled]).toEqual([false, true]);
    expect(root.querySelector<HTMLElement>(".progress")?.hidden).toBe(true);

    play.click();
    expect(seeker?.disabled).toBe(false);
    seeker?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    await until(() => log.calls.includes("seek:12000"));
  });

  it("exports in the page with the dialog's choices and offers the file for download", async () => {
    const calls: BrowserExportOptions[] = [];
    const { root } = await mount("?example=svg-chart", false, {
      bytesToBase64: () => "",
      async exportVideo(options) {
        calls.push(options);
        options.onProgress?.({
          phase: "frames",
          frames: 3,
          totalFrames: 6,
          built: 1,
          layers: 2,
          elapsedMs: 50,
          etaMs: null,
        });
        const blob = new Blob(["VIDEO"], { type: "video/webm" });
        return {
          blob,
          extension: "webm",
          durationMs: 2000,
          finished: true,
          soundUnsupported: false,
          warnings: ["https://img.test/a.png could not be embedded in the frame (Failed to fetch); it is left blank"],
        } as BrowserExportResult;
      },
    });
    const { dialog, start, download, status } = await openExport(root);
    const size = dialog.querySelector<HTMLSelectElement>("select");
    if (size) size.value = "square";
    size?.dispatchEvent(new Event("change"));
    dialog.querySelector<HTMLInputElement>('input[type="radio"][value="60"]')?.click();
    dialog.querySelector<HTMLInputElement>("input.switch")?.click();
    start.click();

    await until(() => !download.hidden);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: { name: "chart.svg" },
      width: 1080,
      height: 1080,
      fps: 60,
      network: "https",
      settings: { seed: app?.context.settings.seed, sound: false, locale: "en" },
    });
    expect(calls[0]?.input.text).toContain("<svg");
    expect(download.download).toBe("chart.webm");
    expect(await (await fetch(download.href)).text()).toBe("VIDEO");
    expect([start.hidden, status.textContent]).toEqual([
      false,
      expect.stringMatching(
        /^Done: 0:02 long, .+\. 1 image or font is missing from the video because it couldn't be read\.$/,
      ),
    ]);
  });

  it("reports a failed and a cancelled export without a download", async () => {
    let runs = 0;
    let signal: AbortSignal | undefined;
    const { root } = await mount("?example=svg-chart", false, {
      bytesToBase64: () => "",
      exportVideo(options) {
        runs += 1;
        signal = options.signal;
        if (runs === 1) return Promise.reject(new Error("encoder broke"));
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal?.reason)));
      },
    });
    const { start, cancel, download, status } = await openExport(root);
    const shown = () => [start.hidden, cancel.hidden, download.hidden];
    start.click();
    await until(() => status.textContent === "Export failed: encoder broke");
    expect(shown()).toEqual([false, true, true]);

    start.click();
    expect(shown()).toEqual([true, false, true]);
    await until(() => runs === 2);
    cancel.click();
    await until(() => status.textContent === "Export cancelled.");
    expect([signal?.aborted, ...shown()]).toEqual([true, false, true, true]);
  });

  it("hands focus to the result only from Cancel, never from where the user moved on to", async () => {
    let finish: ((result: BrowserExportResult) => void) | null = null;
    const done = {
      blob: new Blob(["V"]),
      extension: "webm",
      durationMs: 1000,
      finished: true,
      soundUnsupported: false,
      warnings: [],
    } as BrowserExportResult;
    const { root } = await mount("?example=svg-chart", false, {
      bytesToBase64: () => "",
      exportVideo: () => new Promise((resolve) => (finish = resolve)),
    });
    const { dialog, start, cancel, download } = await openExport(root);
    const settle = async () => {
      (await until(() => finish))(done);
      finish = null;
      await until(() => !download.hidden);
    };
    start.click();
    expect(document.activeElement).toBe(cancel);
    await settle();
    expect(document.activeElement).toBe(download);

    start.click();
    const copy = dialog.querySelector<HTMLButtonElement>(".cli-copy");
    copy?.focus();
    await settle();
    expect(document.activeElement).toBe(copy);
  });

  it("cancels at once while the exporter is still loading", async () => {
    const unused = () => Promise.reject(new Error("not loaded yet"));
    const { root, services } = await mount("?example=svg-chart", false, {
      bytesToBase64: () => "",
      exportVideo: unused,
    });
    // A stalled network: the exporter's download never ends.
    services.loadExporter = () => new Promise(() => undefined);
    const { start, cancel, status } = await openExport(root);
    start.click();
    cancel.click();
    await until(() => status.textContent === "Export cancelled.");
    expect([start.hidden, cancel.hidden]).toEqual([false, true]);
  });

  it("leaves Esc to an open export dialog and opens no panel behind it", async () => {
    await page.viewport(1280, 800);
    try {
      const unused = () => Promise.reject(new Error("unused"));
      const { root } = await mount("?example=svg-chart", false, { bytesToBase64: () => "", exportVideo: unused });
      // The desktop settings drawer stays open beside the stage; the export dialog opens over it.
      app?.context.toggleSettings();
      const { dialog, start } = await openExport(root);
      start.focus();
      await userEvent.keyboard("s?");
      expect([app?.context.settingsOpen(), document.querySelectorAll("dialog:modal").length]).toEqual([true, 1]);
      await userEvent.keyboard("{Escape}");
      await until(() => !dialog.open);
      expect(app?.context.settingsOpen()).toBe(true);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("explains an unknown example instead of mounting a player", async () => {
    const { root, log } = await mount("?example=missing");
    await until(() => root.querySelector(".stage-error"));
    expect(log.players).toHaveLength(0);
  });

  it("applies the Motion setting to Studio's own animations, not only the player", async () => {
    const { root } = await mount();
    const cursor = await until(() => root.querySelector<HTMLElement>(".decor-cursor"));
    const iterations = () => getComputedStyle(cursor).animationIterationCount;
    app?.context.updateSettings({ reducedMotion: "reduce" });
    expect(iterations()).toBe("1");
    // "full" overrides a system reduce preference, matching what the player gets.
    app?.context.updateSettings({ reducedMotion: "full" });
    expect(iterations()).toBe("infinite");
  });

  it("plays each history entry's own local file after Back", async () => {
    const { log } = await mount();
    const open = (name: string, text: string) =>
      app?.context.navigate({ source: { kind: "file", name } }, { local: { name, text } });
    open("alpha.md", "ALPHA_UNIQUE");
    await until(() => log.loads.length === 1);
    app?.context.navigate({ source: null });
    open("beta.md", "BETA_UNIQUE");
    await until(() => log.loads.length === 2);
    history.go(-2);
    await until(() => log.loads.length === 3);
    expect(log.loads[2]).toMatchObject({ name: "alpha.md", text: "ALPHA_UNIQUE" });
  });

  it("keeps a finished build and a paste draft across a language switch", async () => {
    const { root, log } = await mount("?example=svg-chart&lang=en");
    (await until(() => root.querySelector<HTMLButtonElement>(".play-big"))).click();
    const player = await until(() => root.querySelector<HTMLElement>('.view-player[data-phase="done"]'));
    app?.context.updateSettings({ locale: "de" });
    await until(() => document.documentElement.lang === "de");
    expect(root.querySelector(".view-player")).toBe(player);
    expect([player.dataset.phase, log.players.length]).toEqual(["done", 1]);
    expect(player.querySelector(".appbar")?.textContent).toContain("Exportieren");

    app?.context.navigate({ source: null });
    root.querySelector<HTMLButtonElement>(".dropzone-actions button[aria-controls]")?.click();
    const area = root.querySelector<HTMLTextAreaElement>(".paste-area");
    if (area) area.value = "# Draft";
    app?.context.updateSettings({ locale: "en" });
    await until(() => document.documentElement.lang === "en");
    expect(root.querySelector<HTMLTextAreaElement>(".paste-area")?.value).toBe("# Draft");
    expect(root.querySelector<HTMLElement>(".paste-panel")?.hidden).toBe(false);
  });

  it("shows toasts inside an open modal settings sheet, where they can be used", async () => {
    await mount();
    app?.context.toggleSettings();
    const sheet = await until(() => document.querySelector<HTMLDialogElement>("dialog.panel-settings:modal"));
    app?.toast.show("Reload to apply", { action: { label: "Reload", run: () => undefined } });
    const action = document.querySelector<HTMLButtonElement>(".toast-action");
    action?.focus();
    expect(document.activeElement).toBe(action);
    expect(action?.closest("dialog")).toBe(sheet);

    app?.context.toggleSettings();
    await until(() => !action?.closest("dialog"));
    expect(action?.isConnected).toBe(true);
  });

  it("keeps the file picker for ?import=1 on a watch-sized window", async () => {
    await page.viewport(320, 400);
    try {
      const { root } = await mount("?import=1");
      expect(document.documentElement.dataset.view).toBe("home");
      expect(root.querySelector('input[type="file"]')).not.toBeNull();
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("keeps the home brand clear of the app bar buttons in a narrow side panel", async () => {
    // A desktop screen, so the narrow window keeps the normal home instead of the watch face.
    Object.defineProperties(screen, {
      width: { value: 1280, configurable: true },
      height: { value: 800, configurable: true },
    });
    try {
      for (const width of [280, 320, 360]) {
        await page.viewport(width, 400);
        const { root } = await mount();
        const actions = root.querySelector<HTMLElement>(".appbar-actions")?.getBoundingClientRect();
        const word = root.querySelector<HTMLElement>(".brand-word");
        if (!actions || !word) throw new Error(`no app bar at ${width}px`);
        if (word.getClientRects().length > 0) {
          expect(word.getBoundingClientRect().right, `${width}px`).toBeLessThanOrEqual(actions.left);
        }
        app?.destroy();
        app = null;
      }
    } finally {
      delete (screen as { width?: number }).width;
      delete (screen as { height?: number }).height;
      await page.viewport(414, 896);
    }
  });

  it("lets a 320px phone scroll to the actions of a long German error card", async () => {
    await page.viewport(320, 568);
    try {
      history.replaceState(null, "", `${location.pathname}?lang=de&src=https://example.test/unsupported.xyz`);
      const root = document.createElement("div");
      document.body.append(root);
      const { services } = fakeServices({
        manifest: MANIFEST,
        examplesBase: EXAMPLES_BASE,
        fetch: async () => new Response(new Uint8Array(9)),
      });
      // The unsupported-format message lists every format Studio opens, the longest error body.
      services.load = async () => {
        throw Object.assign(new Error("unsupported"), { name: "SourceError", code: "unsupported" });
      };
      app = await mountStudio(root, services);
      const card = await until(() => root.querySelector<HTMLElement>(".stage-error"));
      const overlay = card.parentElement as HTMLElement;
      const frame = overlay.getBoundingClientRect();
      expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(frame.top);
      overlay.scrollTop = overlay.scrollHeight;
      for (const action of overlay.querySelectorAll<HTMLElement>(".stage-error-actions .btn")) {
        const r = action.getBoundingClientRect();
        expect(r.top).toBeGreaterThanOrEqual(frame.top);
        expect(r.bottom).toBeLessThanOrEqual(frame.bottom);
      }
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("keeps the drop zone's cursors clear of a long German title on a 320px phone", async () => {
    await page.viewport(320, 568);
    try {
      const { root } = await mount("?lang=de");
      const inner = await until(() => root.querySelector<HTMLElement>(".dropzone-inner"));
      const content = inner.getBoundingClientRect();
      const cursors = [...root.querySelectorAll<HTMLElement>(".dropzone .decor-cursor")].filter(
        (el) => el.getClientRects().length > 0,
      );
      expect(cursors.length).toBeGreaterThan(0);
      const drift = 10; // the most the drift keyframes move a cursor, in px
      for (const cursor of cursors) {
        cursor.style.animation = "none";
        const r = cursor.getBoundingClientRect();
        const clear =
          r.bottom + drift <= content.top ||
          r.top - drift >= content.bottom ||
          r.right + drift <= content.left ||
          r.left - drift >= content.right;
        expect(clear, cursor.textContent ?? "").toBe(true);
      }
    } finally {
      await page.viewport(414, 896);
    }
  });
});
