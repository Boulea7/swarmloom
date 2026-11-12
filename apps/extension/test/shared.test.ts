import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { detectBackgroundCapabilities, detectPageCapabilities, fileAccessState } from "../src/shared/capabilities";
import { catalogFor, createTranslator, matchLocale, resolveLocale } from "../src/shared/i18n";
import { noticeUrl, studioLinkPatterns, studioUrl } from "../src/shared/links";
import { parseCaptureReply, parseLaunch, parseMessage } from "../src/shared/messages";
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, sanitizePrefs, savePrefs, toPlayerOptions } from "../src/shared/prefs";
import { type ClassifyContext, classifyInjectionError, classifyUrl } from "../src/shared/restricted";
import { createFake } from "./fake-api";

describe("restricted pages", () => {
  const chromium: ClassifyContext = {
    extensionOrigin: "chrome-extension://abc/",
    engine: "chromium",
    fileAccess: "unknown",
  };
  const gecko: ClassifyContext = { ...chromium, extensionOrigin: "moz-extension://uuid/", engine: "gecko" };

  it.each([
    ["https://example.com/a", chromium, { kind: "page" }],
    [undefined, chromium, { kind: "page" }],
    ["chrome://settings/", chromium, { kind: "restricted", reason: "browser-page" }],
    ["about:addons", gecko, { kind: "restricted", reason: "browser-page" }],
    ["https://chromewebstore.google.com/detail/x", chromium, { kind: "restricted", reason: "store" }],
    ["https://chromewebstore.google.com/detail/x", gecko, { kind: "page" }],
    ["https://addons.mozilla.org/en-US/firefox/", gecko, { kind: "restricted", reason: "store" }],
    ["https://example.com/paper.PDF?x=1", chromium, { kind: "document", url: "https://example.com/paper.PDF?x=1" }],
    [
      "view-source:https://example.com/",
      chromium,
      { kind: "restricted", reason: "view-source", url: "https://example.com/" },
    ],
    [
      "about:reader?url=https%3A%2F%2Fexample.com%2F",
      gecko,
      { kind: "restricted", reason: "view-source", url: "https://example.com/" },
    ],
    ["chrome-extension://other/page.html", chromium, { kind: "restricted", reason: "extension-page" }],
    ["chrome-extension://abc/demo.html?x", chromium, { kind: "own-page", page: "demo" }],
    ["file:///tmp/a.html", { ...chromium, fileAccess: "denied" }, { kind: "restricted", reason: "file-access" }],
    [
      "file:///tmp/a.html",
      { ...chromium, fileAccess: "unsupported" },
      { kind: "restricted", reason: "file-unsupported" },
    ],
    ["file:///tmp/a.pdf", { ...chromium, fileAccess: "granted" }, { kind: "document" }],
  ] as const)("%s", (url, ctx, expected) => {
    expect(classifyUrl(url, ctx)).toMatchObject(expected);
  });

  it("turns injection errors into reasons", () => {
    expect(classifyInjectionError('Cannot access contents of url "file:///a"', "file:///a")).toBe("file-access");
    expect(classifyInjectionError("The extensions gallery cannot be scripted.", "https://x/")).toBe("store");
    expect(classifyInjectionError("Missing host permission for the tab", "https://x/")).toBe("blocked");
    // Real Chromium message when the tab URL is hidden from the extension.
    expect(classifyInjectionError("Cannot access a chrome:// URL", undefined)).toBe("browser-page");
    expect(classifyInjectionError("Cannot access a chrome-extension:// URL of different extension", undefined)).toBe(
      "extension-page",
    );
  });
});

describe("preferences", () => {
  it("sanitizes field by field", () => {
    const prefs = sanitizePrefs({
      speed: 99,
      agents: 12,
      theme: "neon",
      volume: "loud",
      locale: "ja",
      soundPack: "8bit",
    });
    expect(prefs).toMatchObject({ speed: 3, agents: 12, theme: DEFAULT_PREFS.theme, volume: DEFAULT_PREFS.volume });
    expect(prefs).toMatchObject({ locale: "ja", soundPack: "8bit" });
    expect(sanitizePrefs("garbage")).toEqual(DEFAULT_PREFS);
  });

  it("loads the newest copy and survives a failing sync area", async () => {
    const fake = createFake();
    fake.local.set(PREFS_KEY, { prefs: { ...DEFAULT_PREFS, speed: 1.5 }, savedAt: 10 });
    fake.sync.set(PREFS_KEY, { prefs: { ...DEFAULT_PREFS, speed: 2.5 }, savedAt: 20 });
    expect((await loadPrefs(fake.api)).speed).toBe(2.5);

    const sync = fake.api.storage.sync;
    if (!sync) throw new Error("fake has sync storage");
    sync.set = () => Promise.reject(new Error("QUOTA_BYTES_PER_ITEM"));
    sync.get = () => Promise.reject(new Error("sync disabled"));
    await savePrefs(fake.api, { ...DEFAULT_PREFS, speed: 3 }, 30);
    expect((await loadPrefs(fake.api)).speed).toBe(3);
    expect(JSON.stringify(fake.local.get(PREFS_KEY)).length).toBeLessThan(400);
  });

  it("maps to overlay player options and disables sound without WebAudio", () => {
    const options = toPlayerOptions(
      { ...DEFAULT_PREFS, sound: true, reducedMotion: "on" },
      { audio: false, locale: "fr", seed: 4 },
    );
    expect(options).toMatchObject({
      mode: "overlay",
      reducedMotion: true,
      seed: 4,
      locale: "fr",
      sound: { enabled: false },
    });
  });
});

describe("messages, links and locales", () => {
  it("drops malformed input", () => {
    expect(parseMessage({ type: "swarmloom:demo-toggle", tabId: "7" })).toBeNull();
    expect(parseMessage({ type: "other" })).toBeNull();
    expect(parseCaptureReply({ ok: true, dataUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
    const launch = parseLaunch({
      kind: "evil",
      prefs: null,
      locale: "xx",
      strings: { errorTitle: 5 },
      playerMessages: "x",
    });
    expect(launch).toMatchObject({ kind: "page", capture: false, locale: "en", prefs: DEFAULT_PREFS });
    expect(launch.strings.errorTitle).not.toBe("");
    expect(launch.playerMessages).toEqual({});
    expect(parseLaunch({ playerMessages: { "toolbar.play": "Los" } }).playerMessages).toEqual({
      "toolbar.play": "Los",
    });
  });

  it("keeps the catalogs out of the content script, apart from the English session strings", async () => {
    // swarm.js gets its strings in the launch request and must stay within its size budget (scripts/audit.mjs).
    const result = await build({
      stdin: {
        contents: 'import { parseLaunch } from "./src/shared/messages"; console.log(parseLaunch(null));',
        resolveDir: join(dirname(fileURLToPath(import.meta.url)), ".."),
        loader: "ts",
      },
      bundle: true,
      write: false,
      charset: "utf8",
      logLevel: "silent",
    });
    const code = result.outputFiles[0]?.text ?? "";
    const fallback = new Set(Object.values(parseLaunch(null).strings));
    const leaked = Object.values(catalogFor("en")).filter((s) => !fallback.has(s) && code.includes(JSON.stringify(s)));
    expect(fallback.size).toBeGreaterThan(1);
    expect(leaked).toEqual([]);
  });

  it("builds Studio and notice links that only carry web or file sources", () => {
    const getURL = (p: string) => `chrome-extension://abc/${p}`;
    expect(new URL(studioUrl(getURL, { src: "javascript:alert(1)" })).searchParams.has("src")).toBe(false);
    expect(new URL(studioUrl(getURL, { importFile: true })).searchParams.get("import")).toBe("1");
    const notice = new URL(noticeUrl(getURL, "store", `https://x/${"a".repeat(5000)}`));
    expect(notice.searchParams.get("reason")).toBe("store");
    expect(notice.searchParams.has("url")).toBe(false);
  });

  it("offers the Studio link menu for every file format Studio reads, but not for web pages", () => {
    const patterns = studioLinkPatterns(false);
    for (const ext of ["pdf", "epub", "rtf", "odt", "ofd", "ipynb", "cast", "patch", "xmind", "bmp", "jfif"]) {
      expect(patterns, ext).toContain(`*://*/*.${ext}`);
    }
    for (const ext of ["html", "php"]) expect(patterns, ext).not.toContain(`*://*/*.${ext}`);
  });

  it("resolves locales with Chinese script variants and English fallback", () => {
    expect(matchLocale("zh-HK")).toBe("zh-TW");
    expect(matchLocale("zh-Hans-SG")).toBe("zh-CN");
    expect(resolveLocale("auto", ["pt-BR", "ko-KR"])).toBe("ko");
    expect(resolveLocale("auto", ["pt-BR"])).toBe("en");
    expect(createTranslator("fr").t("badgeBlockedTitle", { reason: "R" })).toContain("R");
  });
});

describe("capabilities", () => {
  it("intersects the build-time set with what the browser exposes", async () => {
    const full = createFake();
    expect(detectBackgroundCapabilities(full.api, "chrome")).toMatchObject({
      scripting: true,
      contextMenus: true,
      sidePanel: false,
    });
    expect(detectBackgroundCapabilities(createFake({ menus: false, scripting: false }).api, "safari")).toMatchObject({
      scripting: false,
      contextMenus: false,
    });
    expect(detectPageCapabilities({}, "chrome")).toEqual({ audio: false, viewportSegments: false });
    expect(detectPageCapabilities({ webkitAudioContext: class {} }, "safari").audio).toBe(true);
    expect(await fileAccessState(full.api, "chrome")).toBe("denied");
    expect(await fileAccessState(full.api, "firefox")).toBe("unknown");
    expect(await fileAccessState(full.api, "safari")).toBe("unsupported");
  });
});
