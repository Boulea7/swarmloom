/**
 * Background controller: turns toolbar clicks, the shortcut, context menu picks and runtime
 * messages into injections, Studio tabs or a restricted-page notice.
 *
 * It keeps no state that matters across service worker restarts: every event re-derives what it
 * needs from the tab, the manifest and storage. Long-lived work (animation, audio, snapshot) runs
 * in the content script, never here.
 */

import {
  actionApi,
  type ExtensionApi,
  errorMessage,
  type MenuClickInfo,
  type MenuCreateProperties,
  type MessageListener,
  type MessageSender,
  menusApi,
  type Tab,
} from "../shared/api";
import { engineOf, type TargetId } from "../shared/build-info";
import { type BackgroundCapabilities, detectBackgroundCapabilities, fileAccessState } from "../shared/capabilities";
import { createTranslator, resolveLocale, type Translator } from "../shared/i18n";
import { noticeUrl, studioLinkPatterns, studioSource, studioUrl } from "../shared/links";
import {
  type CaptureReply,
  type LaunchRequest,
  MSG,
  parseCaptureReply,
  parseMessage,
  sessionStrings,
  type TargetHints,
} from "../shared/messages";
import { requestSourceAccess } from "../shared/permissions";
import { loadPrefs, PREFS_KEY, type Prefs } from "../shared/prefs";
import {
  type BlockReason,
  classifyInjectionError,
  classifyUrl,
  type PageVerdict,
  reasonMessageKey,
} from "../shared/restricted";
import { readSessionState, resolveContextTarget, setLaunchRequest, stopRunningSession } from "./injected";
import { TabQueue } from "./tab-queue";

export const MENU = {
  rebuildPage: "swarmloom-rebuild-page",
  rebuildElement: "swarmloom-rebuild-element",
  openLink: "swarmloom-open-link",
  openImage: "swarmloom-open-image",
  openPage: "swarmloom-open-page",
} as const;

export const CONTENT_FILES = { swarm: "swarm.js", tracker: "tracker.js" } as const;

const BADGE_COLOR = "#FF4F7B";
const BADGE_TEXT = "!";
/** The notice tab carries the full explanation; the badge is a short-lived cue on the original tab. */
const BADGE_CLEAR_MS = 8000;
/** Chromium allows two captures per second; stay under it. */
const CAPTURE_MIN_INTERVAL_MS = 600;

const PDF_PAGES = ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"];

export interface BackgroundOptions {
  target?: TargetId;
  /** Timer used to clear badges. Default `setTimeout`. */
  setTimer?: (fn: () => void, ms: number) => void;
  /** Monotonic clock for capture rate limiting. Default `performance.now`. */
  now?: () => number;
}

export type SwarmRun = "started" | "stopped";

export interface Background {
  readonly capabilities: BackgroundCapabilities;
  /** Toolbar button or Alt+Shift+W. The synchronous prefix runs inside the user gesture. */
  handleAction(tab: Tab): Promise<void>;
  handleMenu(info: MenuClickInfo, tab: Tab | undefined): Promise<void>;
  handleMessage: MessageListener;
  handleInstalled(details: { reason: string }): Promise<void>;
  /** (Re)creates the context menus in the preferred language; no-op where menus do not exist. */
  setupMenus(): Promise<void>;
  /** Session phase in a tab (e2e hook). */
  readState(tabId: number): Promise<{ phase: string; error: string | null } | null>;
  /** Registers every listener; call once at the top level of the background script. */
  register(): void;
}

function logError(error: unknown): void {
  console.error("SwarmLoom:", error);
}

/** Creates the background controller for `api`. */
export function createBackground(api: ExtensionApi, opts: BackgroundOptions = {}): Background {
  const target = opts.target ?? "chrome";
  const engine = engineOf(target);
  const capabilities = detectBackgroundCapabilities(api, target);
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  const now = opts.now ?? (() => performance.now());
  const queue = new TabQueue();
  const lastCapture = new Map<number, number>();
  const getURL = (path: string) => api.runtime.getURL(path);
  const extensionOrigin = getURL("");
  // Firefox Android cannot show host permission prompts reliably (bugs 1820867 and 1812125), so
  // Studio gets the link plus its file picker instead. Asked from the API, never the user agent;
  // until the answer arrives (first event after a cold start) the desktop path is used.
  let android = false;
  try {
    Promise.resolve(api.runtime.getPlatformInfo?.())
      .then((info) => {
        android = info?.os === "android";
      })
      .catch(() => undefined);
  } catch {
    // No platform info: keep the desktop behaviour.
  }

  async function context(): Promise<{ prefs: Prefs; tr: Translator }> {
    const prefs = await loadPrefs(api);
    return { prefs, tr: createTranslator(resolveLocale(prefs.locale, [api.i18n.getUILanguage()])) };
  }

  async function translator(): Promise<Translator> {
    return (await context()).tr;
  }

  function classify(url: string | undefined, fileAccess: Parameters<typeof classifyUrl>[1]["fileAccess"]) {
    return classifyUrl(url, { extensionOrigin, engine, fileAccess });
  }

  async function exec(injection: Parameters<NonNullable<ExtensionApi["scripting"]>["executeScript"]>[0]) {
    if (!api.scripting) throw new Error("scripting API unavailable");
    return api.scripting.executeScript(injection);
  }

  async function openTab(url: string, opener?: Tab): Promise<void> {
    try {
      await api.tabs.create(
        opener?.id === undefined ? { url } : { url, index: opener.index + 1, openerTabId: opener.id },
      );
    } catch {
      // Some mobile browsers reject index/openerTabId; the tab itself is what matters.
      await api.tabs.create({ url });
    }
  }

  /**
   * The permission request runs synchronously, before any await: Firefox only shows prompts for
   * calls made directly inside user input handlers. Without access to a remote origin (declined,
   * asked outside a gesture, or not requestable as on Safari) Studio can only read the file when
   * the site allows CORS, so it also gets the file picker fallback.
   */
  function openInStudio(src: string | undefined, opener?: Tab, importFile = false): Promise<void> {
    const source = studioSource(src);
    if (source?.startsWith("file:")) return openLocalInStudio(source, opener);
    if (source && android) return openTab(studioUrl(getURL, { src: source, importFile: true }), opener);
    const remote = source !== null;
    const granted = remote ? requestSourceAccess(api, source) : Promise.resolve(false);
    return granted.then((ok) =>
      openTab(studioUrl(getURL, { src: source ?? undefined, importFile: importFile || (remote && !ok) }), opener),
    );
  }

  /**
   * Studio, an extension page, can read a `file:` URL only where the browser gives the extension
   * file access (Chromium's "Allow access to file URLs"); Safari and Firefox never do. Without it
   * Studio opens on its file picker instead of a link it cannot load, and with it the picker stays
   * the fallback should the read still fail.
   */
  async function openLocalInStudio(source: string, opener?: Tab): Promise<void> {
    const readable = (await fileAccessState(api, target)) === "granted";
    await openTab(studioUrl(getURL, { src: readable ? source : undefined, importFile: true }), opener);
  }

  async function clearBadge(tabId: number, t?: Translator): Promise<void> {
    const action = actionApi(api);
    if (!action) return;
    const tr = t ?? (await translator());
    await Promise.allSettled([
      action.setBadgeText({ tabId, text: "" }),
      action.setTitle({ tabId, title: tr.t("actionTitle") }),
    ]);
  }

  async function showBlocked(tab: Tab, reason: BlockReason, url: string | undefined): Promise<void> {
    const t = await translator();
    const action = actionApi(api);
    if (action && tab.id !== undefined) {
      const tabId = tab.id;
      const title = t.t("badgeBlockedTitle", { reason: t.t(reasonMessageKey(reason)) });
      await Promise.allSettled([
        action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }),
        action.setBadgeText({ tabId, text: BADGE_TEXT }),
        action.setTitle({ tabId, title }),
      ]);
      setTimer(() => void clearBadge(tabId, t).catch(logError), BADGE_CLEAR_MS);
    }
    await openTab(noticeUrl(getURL, reason, url), tab);
  }

  async function runSwarm(
    tabId: number,
    frameId: number,
    kind: LaunchRequest["kind"],
    mode: "toggle" | "restart",
  ): Promise<SwarmRun> {
    const where = { tabId, frameIds: [frameId] };
    const [probe] = await exec({ target: where, func: stopRunningSession });
    if (probe?.result === true && mode === "toggle") return "stopped";
    const { prefs, tr } = await context();
    const launch: LaunchRequest = {
      kind,
      capture: capabilities.capturePoster && frameId === 0,
      prefs,
      locale: tr.locale,
      strings: sessionStrings(tr.t),
    };
    await exec({ target: where, func: setLaunchRequest, args: [launch] });
    await exec({ target: where, files: [CONTENT_FILES.swarm] });
    if (capabilities.contextMenus) {
      // From now on remember right-clicked elements in this page, so "Rebuild this element" is exact.
      exec({ target: where, files: [CONTENT_FILES.tracker] }).catch(() => undefined);
    }
    return "started";
  }

  async function toggleDemo(tabId: number): Promise<void> {
    try {
      await api.runtime.sendMessage({ type: MSG.demoToggle, tabId });
    } catch (error) {
      logError(error);
    }
  }

  async function actOnTab(tab: Tab, initial: PageVerdict, mode: "toggle" | "restart"): Promise<void> {
    const tabId = tab.id as number;
    await clearBadge(tabId);
    let verdict = initial;
    if (verdict.kind === "page" && tab.url?.startsWith("file:")) {
      verdict = classify(tab.url, await fileAccessState(api, target));
    }
    switch (verdict.kind) {
      case "own-page":
        return verdict.page === "demo" ? toggleDemo(tabId) : openTab(getURL("demo.html"), tab);
      case "document":
        return openInStudio(verdict.url, tab);
      case "restricted":
        return showBlocked(tab, verdict.reason, verdict.url ?? tab.url);
      default:
        break;
    }
    if (!capabilities.scripting) return showBlocked(tab, "blocked", tab.url);
    try {
      await runSwarm(tabId, 0, "page", mode);
    } catch (error) {
      await showBlocked(tab, classifyInjectionError(errorMessage(error), tab.url), tab.url);
    }
  }

  async function rebuildElement(tab: Tab, info: MenuClickInfo): Promise<void> {
    const tabId = tab.id as number;
    const frameId = info.frameId ?? 0;
    const where = { tabId, frameIds: [frameId] };
    const hints: TargetHints = {
      srcUrl: info.srcUrl,
      linkUrl: info.linkUrl,
      selectionText: info.selectionText,
      targetElementId: info.targetElementId,
      prompt: (await translator()).t("pickPrompt"),
    };
    try {
      await exec({ target: where, files: [CONTENT_FILES.tracker] });
      const [found] = await exec({ target: where, func: resolveContextTarget, args: [hints] });
      // "picking": the tracker asks the user to click an element and messages us back.
      if (found?.result === "picking") return;
      await runSwarm(tabId, frameId, found?.result === "found" ? "element" : "page", "restart");
    } catch (error) {
      await showBlocked(tab, classifyInjectionError(errorMessage(error), tab.url), tab.url);
    }
  }

  function handleAction(tab: Tab): Promise<void> {
    if (tab.id === undefined) return Promise.resolve();
    const verdict = classify(tab.url, "unknown");
    // Documents first and synchronously: the host permission prompt needs the live user gesture.
    if (verdict.kind === "document" && !verdict.url.startsWith("file:")) return openInStudio(verdict.url, tab);
    return queue.run(tab.id, () => actOnTab(tab, verdict, "toggle"));
  }

  function handleMenu(info: MenuClickInfo, tab: Tab | undefined): Promise<void> {
    const id = String(info.menuItemId);
    if (id === MENU.openLink) return openInStudio(info.linkUrl, tab);
    if (id === MENU.openImage) return openInStudio(info.srcUrl, tab);
    if (id === MENU.openPage) return openInStudio(info.frameUrl ?? info.pageUrl ?? tab?.url, tab);
    if (tab?.id === undefined) return Promise.resolve();
    const verdict = classify(info.pageUrl ?? tab.url, "unknown");
    if (verdict.kind === "document" && !verdict.url.startsWith("file:")) return openInStudio(verdict.url, tab);
    if (id === MENU.rebuildPage) return queue.run(tab.id, () => actOnTab(tab, verdict, "restart"));
    if (id === MENU.rebuildElement) {
      if (verdict.kind !== "page") return queue.run(tab.id, () => actOnTab(tab, verdict, "restart"));
      return queue.run(tab.id, () => rebuildElement(tab, info));
    }
    return Promise.resolve();
  }

  async function capture(sender: MessageSender): Promise<CaptureReply> {
    const tabId = sender.tab?.id;
    if (!capabilities.capturePoster || tabId === undefined || (sender.frameId ?? 0) !== 0) {
      return { ok: false, error: "unsupported" };
    }
    try {
      const tab = await api.tabs.get(tabId);
      // captureVisibleTab shoots the active tab of the window; refuse when that is another tab.
      if (!tab.active) return { ok: false, error: "tab is not active" };
      const at = now();
      if (at - (lastCapture.get(tab.windowId) ?? Number.NEGATIVE_INFINITY) < CAPTURE_MIN_INTERVAL_MS) {
        return { ok: false, error: "rate limited" };
      }
      lastCapture.set(tab.windowId, at);
      const dataUrl = await api.tabs.captureVisibleTab?.(tab.windowId, { format: "png" });
      return parseCaptureReply({ ok: true, dataUrl });
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  const handleMessage: MessageListener = (message, sender, sendResponse) => {
    if (sender.id !== api.runtime.id) return undefined;
    const msg = parseMessage(message);
    const tab = sender.tab;
    switch (msg?.type) {
      case MSG.capture:
        void capture(sender).then(sendResponse);
        return true;
      case MSG.elementPicked:
        if (tab?.id !== undefined) {
          const tabId = tab.id;
          void queue
            .run(tabId, () => runSwarm(tabId, sender.frameId ?? 0, "element", "restart"))
            .catch((error) => showBlocked(tab, classifyInjectionError(errorMessage(error), tab.url), tab.url))
            .catch(logError);
        }
        return undefined;
      case MSG.openStudio:
        void openInStudio(msg.src, tab, msg.importFile).catch(logError);
        return undefined;
      default:
        return undefined;
    }
  };

  function createMenu(props: MenuCreateProperties): Promise<void> {
    const menus = menusApi(api);
    return new Promise((resolve) => {
      if (!menus) return resolve();
      menus.create(props, () => {
        const error = api.runtime.lastError;
        if (error) console.warn("SwarmLoom: menu", props.id, error.message);
        resolve();
      });
    });
  }

  async function setupMenus(): Promise<void> {
    const menus = menusApi(api);
    if (!capabilities.contextMenus || !menus) return;
    await menus.removeAll();
    const t = await translator();
    const files = capabilities.fileAccess ? ["file:///*"] : [];
    const pages = ["http://*/*", "https://*/*", ...files];
    await createMenu({
      id: MENU.rebuildPage,
      title: t.t("menuRebuildPage"),
      contexts: ["page"],
      documentUrlPatterns: pages,
    });
    await createMenu({
      id: MENU.rebuildElement,
      title: t.t("menuRebuildElement"),
      contexts: ["page", "selection", "link", "image", "video", "audio", "frame"],
      documentUrlPatterns: pages,
    });
    await createMenu({
      id: MENU.openLink,
      title: t.t("menuOpenLink"),
      contexts: ["link"],
      targetUrlPatterns: studioLinkPatterns(capabilities.fileAccess),
    });
    await createMenu({
      id: MENU.openImage,
      title: t.t("menuOpenImage"),
      contexts: ["image"],
      targetUrlPatterns: ["http://*/*", "https://*/*"],
    });
    await createMenu({
      id: MENU.openPage,
      title: t.t("menuOpenPage"),
      contexts: ["page"],
      documentUrlPatterns: [...PDF_PAGES, ...files.map(() => "file:///*.pdf")],
    });
  }

  async function handleInstalled(details: { reason: string }): Promise<void> {
    await setupMenus();
    if (details.reason === "install") await openTab(getURL("welcome.html"));
  }

  async function readState(tabId: number) {
    const [result] = await exec({ target: { tabId, frameIds: [0] }, func: readSessionState });
    return (result?.result ?? null) as { phase: string; error: string | null } | null;
  }

  function localeChanged(change: unknown): boolean {
    const c = change as { oldValue?: { prefs?: { locale?: unknown } }; newValue?: { prefs?: { locale?: unknown } } };
    return c?.oldValue?.prefs?.locale !== c?.newValue?.prefs?.locale;
  }

  function register(): void {
    actionApi(api)?.onClicked.addListener((tab) => void handleAction(tab).catch(logError));
    if (capabilities.contextMenus) {
      menusApi(api)?.onClicked.addListener((info, tab) => void handleMenu(info, tab).catch(logError));
    }
    api.runtime.onMessage.addListener(handleMessage);
    api.runtime.onInstalled.addListener((details) => void handleInstalled(details).catch(logError));
    api.runtime.onStartup.addListener(() => void setupMenus().catch(logError));
    api.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !(PREFS_KEY in changes) || !localeChanged(changes[PREFS_KEY])) return;
      void setupMenus().catch(logError);
    });
  }

  return {
    capabilities,
    handleAction,
    handleMenu,
    handleMessage,
    handleInstalled,
    setupMenus,
    readState,
    register,
  };
}
