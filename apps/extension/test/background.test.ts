import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_FILES, createBackground, MENU } from "../src/background/controller";
import { HOSTED_STUDIO } from "../src/shared/links";
import { GLOBALS, MSG, parseLaunch } from "../src/shared/messages";
import { DEFAULT_PREFS, savePrefs } from "../src/shared/prefs";
import { createFake, tab } from "./fake-api";

type Scope = Record<string, unknown>;
const scope = globalThis as Scope;

/** What swarm.js does, reduced to the parts the background relies on. */
function fakeSwarmScript(file: string): void {
  if (file !== CONTENT_FILES.swarm) return;
  const launch = parseLaunch(scope[GLOBALS.launch]);
  delete scope[GLOBALS.launch];
  const session = {
    phase: "building",
    error: null,
    launch,
    stop() {
      session.phase = "closed";
      delete scope[GLOBALS.session];
    },
  };
  scope[GLOBALS.session] = session;
}

afterEach(() => {
  for (const key of Object.values(GLOBALS)) delete scope[key];
});

describe("toolbar action", () => {
  it("injects launch request, swarm and tracker on a normal page, and stops on the next click", async () => {
    const fake = createFake({ onFile: fakeSwarmScript });
    await savePrefs(fake.api, { ...DEFAULT_PREFS, speed: 2, locale: "zh-CN" }, 5);
    const bg = createBackground(fake.api, { target: "chrome" });

    await bg.handleAction(tab("https://example.com/"));
    expect(fake.injections).toEqual([
      "stopRunningSession",
      "setLaunchRequest",
      CONTENT_FILES.swarm,
      CONTENT_FILES.tracker,
    ]);
    const session = scope[GLOBALS.session] as { phase: string; launch: ReturnType<typeof parseLaunch> };
    expect(session.launch).toMatchObject({ kind: "page", capture: true, locale: "zh-CN", prefs: { speed: 2 } });
    expect(session.launch.strings.errorRetry).not.toBe("");
    await expect(bg.readState(7)).resolves.toEqual({ phase: "building", error: null });

    fake.injections.length = 0;
    await bg.handleAction(tab("https://example.com/"));
    expect(fake.injections).toEqual(["stopRunningSession"]);
    expect(session.phase).toBe("closed");
    expect(fake.createdTabs).toEqual([]);
  });

  it("explains restricted pages with a badge and a notice tab instead of failing silently", async () => {
    const fake = createFake();
    const timers: (() => void)[] = [];
    const bg = createBackground(fake.api, { target: "chrome", setTimer: (fn) => void timers.push(fn) });

    await bg.handleAction(tab("chrome://settings/"));
    expect(fake.injections).toEqual([]);
    expect(fake.badge.get(7)).toMatchObject({ text: "!", color: "#FF4F7B" });
    expect(fake.badge.get(7)?.title).toMatch(/browser/i);
    const notice = new URL(fake.createdTabs[0]?.url ?? "");
    expect(notice.pathname).toBe("/notice.html");
    expect(notice.searchParams.get("reason")).toBe("browser-page");
    expect(fake.createdTabs[0]?.openerTabId).toBe(7);

    for (const fn of timers) fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.badge.get(7)?.text).toBe("");
  });

  it("maps injection failures to a reason and opens PDFs in Studio", async () => {
    const fake = createFake({ injectionError: "The extensions gallery cannot be scripted." });
    const bg = createBackground(fake.api, { target: "edge" });
    await bg.handleAction(tab("https://example.com/"));
    expect(new URL(fake.createdTabs[0]?.url ?? "").searchParams.get("reason")).toBe("store");

    await bg.handleAction(tab("https://example.com/paper.pdf", 8));
    const studio = new URL(fake.createdTabs[1]?.url ?? "");
    expect(studio.href.startsWith(HOSTED_STUDIO)).toBe(true);
    expect(studio.searchParams.get("src")).toBe("https://example.com/paper.pdf");
  });

  it("hands local documents to Studio's file picker unless the extension may read files", async () => {
    const file = "file:///tmp/report.pdf";
    const cases = [
      { target: "safari", fileAccess: false, src: null },
      { target: "chrome", fileAccess: false, src: null },
      { target: "chrome", fileAccess: true, src: file },
    ] as const;
    for (const c of cases) {
      const fake = createFake({ fileAccess: c.fileAccess });
      await createBackground(fake.api, { target: c.target }).handleAction(tab(file));
      const studio = new URL(fake.createdTabs[0]?.url ?? "");
      const name = `${c.target} file access ${c.fileAccess}`;
      expect(studio.searchParams.get("src"), name).toBe(c.src);
      expect(studio.searchParams.get("import"), name).toBe("1");
    }
  });

  it("asks the bundled demo page to toggle itself (extension pages cannot be scripted)", async () => {
    const fake = createFake();
    const bg = createBackground(fake.api, { target: "firefox" });
    await bg.handleAction(tab("chrome-extension://fake/demo.html"));
    expect(fake.sentMessages).toEqual([{ type: MSG.demoToggle, tabId: 7 }]);
    expect(fake.injections).toEqual([]);
  });
});

describe("context menus and messages", () => {
  it("creates localized menus where supported and none on Firefox Android", async () => {
    const chrome = createFake();
    await savePrefs(chrome.api, { ...DEFAULT_PREFS, locale: "de" }, 1);
    await createBackground(chrome.api, { target: "chrome" }).setupMenus();
    expect(chrome.menus.map((m) => m.id)).toEqual(Object.values(MENU));
    expect(chrome.menus[0]?.title).not.toBe("Rebuild this page");

    // The single Firefox package runs on Android, where the menus API does not exist.
    const android = createFake({ menus: false });
    const bg = createBackground(android.api, { target: "firefox" });
    expect(bg.capabilities.contextMenus).toBe(false);
    expect(() => bg.register()).not.toThrow();
    await bg.setupMenus();
    expect(android.menus).toEqual([]);
  });

  it("hands links to Studio with the file picker fallback on Android", async () => {
    const fake = createFake({ platform: "android" });
    const bg = createBackground(fake.api, { target: "firefox" });
    await new Promise((r) => setTimeout(r, 0));
    await bg.handleAction(tab("https://example.com/a.pdf"));
    const studio = new URL(fake.createdTabs[0]?.url ?? "");
    expect(studio.searchParams.get("src")).toBe("https://example.com/a.pdf");
    expect(studio.searchParams.get("import")).toBe("1");
  });

  it("adds the file picker fallback when the bundled Studio gets no access to the link's origin", async () => {
    vi.resetModules();
    vi.doMock("../src/shared/build-info", async (original) => ({
      ...(await original<typeof import("../src/shared/build-info")>()),
      BUNDLED_STUDIO: "studio/studio.html",
    }));
    try {
      const bundled = await import("../src/background/controller");
      const cases = [
        { name: "granted", fake: {}, target: "chrome", picker: null },
        { name: "declined", fake: { grantHosts: false }, target: "chrome", picker: "1" },
        { name: "not requestable", fake: { optionalHosts: false }, target: "safari", picker: "1" },
      ] as const;
      for (const c of cases) {
        const fake = createFake(c.fake);
        const link = "https://b.example/file.pdf";
        await bundled
          .createBackground(fake.api, { target: c.target })
          .handleMenu({ menuItemId: bundled.MENU.openLink, linkUrl: link }, tab("https://a.example/"));
        const studio = new URL(fake.createdTabs[0]?.url ?? "");
        expect(studio.pathname, c.name).toBe("/studio/studio.html");
        expect(studio.searchParams.get("src"), c.name).toBe(link);
        expect(studio.searchParams.get("import"), c.name).toBe(c.picker);
      }
    } finally {
      vi.doUnmock("../src/shared/build-info");
      vi.resetModules();
    }
  });

  it("ignores other senders and rate limits captures per window", async () => {
    const fake = createFake();
    let clock = 1000;
    const bg = createBackground(fake.api, { target: "chrome", now: () => clock });
    const sender = { id: "fake-id", frameId: 0, tab: tab("https://example.com/") };
    const ask = () =>
      new Promise((resolve) => expect(bg.handleMessage({ type: MSG.capture }, sender, resolve)).toBe(true));

    expect(bg.handleMessage({ type: MSG.capture }, { ...sender, id: "intruder" }, () => undefined)).toBeUndefined();
    await expect(ask()).resolves.toMatchObject({ ok: true });
    clock += 100;
    await expect(ask()).resolves.toEqual({ ok: false, error: "rate limited" });
    clock += 600;
    await expect(ask()).resolves.toMatchObject({ ok: true });
  });
});
