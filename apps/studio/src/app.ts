import type { AppContext, NavigateOptions, View } from "./context";
import { describeError } from "./errors";
import { availableFormats } from "./formats-meta";
import { createStudioI18n, loadCatalog, negotiateLocale, type StudioI18n } from "./i18n";
import { watchViewport } from "./layout/viewport";
import { parseRoute, type Route, routeToUrl } from "./route";
import type { StudioServices } from "./services";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  type StudioLocale,
  type StudioSettings,
  sanitizeSettings,
  saveSettings,
} from "./settings";
import { type LocalInput, readLocalFile } from "./source";
import { createPanel, type Panel } from "./ui/dialog";
import { h, isTyping } from "./ui/dom";
import { createToaster, type Toaster } from "./ui/toast";
import { syncThemeButton } from "./views/chrome";
import { createHome, formatLabel } from "./views/home";
import { createPlayerView } from "./views/player";
import { settingsForm } from "./views/settings";
import { createShortcuts } from "./views/shortcuts";
import { createWatch } from "./views/watch";

/** Handle returned by {@link mountStudio}. */
export interface StudioApp {
  readonly context: AppContext;
  readonly toast: Toaster;
  /** Current view root (home, player or watch). */
  readonly view: HTMLElement | null;
  destroy(): void;
}

/** How long a `?launch=1` page waits for the OS to hand over the files before showing home. */
const LAUNCH_WAIT_MS = 3000;

const THEME_COLOR = { light: "#fafafc", dark: "#0b0b12" } as const;

/** Local inputs kept for Back and Forward; an entry whose input was dropped asks to open it again. */
const LOCAL_HISTORY_LIMIT = 8;
/** `history.state` key naming the local input of an entry. */
const LOCAL_STATE_KEY = "swarmloomLocal";

/** A random hex id, so keys left in `history.state` by an earlier page load never match. */
function randomKey(win: Window): string {
  const bytes = win.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Studio locale for a setting: the explicit choice, or the browser's languages. */
function resolveLocale(setting: StudioSettings["locale"], win: Window): StudioLocale {
  return setting === "auto" ? negotiateLocale(win.navigator.languages ?? [win.navigator.language]) : setting;
}

/** Studio and core strings for a locale, or English for both when that locale's strings fail to load. */
async function loadI18n(services: StudioServices, requested: StudioLocale): Promise<StudioI18n> {
  const { locale, catalog } = await loadCatalog(requested);
  let core = null;
  try {
    core = services.coreI18n?.(locale) ?? null;
  } catch (error) {
    console.warn("[studio] core i18n unavailable", error);
  }
  return createStudioI18n(locale, catalog, core);
}

/** The page URL without query or hash: the base every Studio link is built on. */
function appUrlOf(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * Mounts Studio into `root`: routing (query and hash, history), settings, i18n, theme, the shared
 * panels (settings drawer, shortcuts) and the current view. All outside effects go through
 * `services`, so tests mount the real UI with fakes.
 */
export async function mountStudio(
  root: HTMLElement,
  services: StudioServices,
  win: Window = window,
): Promise<StudioApp> {
  const doc = root.ownerDocument;
  const html = doc.documentElement;
  const routeOptions = { allowFileUrls: services.target === "extension" };
  const appUrl = appUrlOf(win.location.href);

  let route: Route = parseRoute(win.location.href, routeOptions);
  let stored = loadSettings(services.storage);
  let settings: StudioSettings = { ...stored, ...route.overrides };
  // The page CSP backs up the adapters' own network checks (decisions-v1 C03). It only tightens:
  // with remote assets off from the start, before anything loads.
  let assetsBlocked = false;
  const syncAssetPolicy = () => {
    if (settings.remoteAssets || assetsBlocked || !services.blockRemoteAssets) return;
    services.blockRemoteAssets();
    assetsBlocked = true;
  };
  syncAssetPolicy();
  let i18n = await loadI18n(services, resolveLocale(settings.locale, win));
  /** Bumped per language change, so only the latest one applies its strings. */
  let localeRequest = 0;
  let local: LocalInput | null = null;
  let view: View | null = null;
  let navigated = false;
  let destroyed = false;

  // Each local input is stored under its own key in the history entry that opened it, so Back and
  // Forward play that entry's file, never the one opened last.
  const locals = new Map<string, LocalInput>();
  const pageKey = randomKey(win);
  let localCount = 0;
  const keepLocal = (input: LocalInput): Record<string, string> => {
    localCount += 1;
    const key = `${pageKey}:${localCount}`;
    locals.set(key, input);
    for (const oldest of locals.keys()) {
      if (locals.size <= LOCAL_HISTORY_LIMIT) break;
      locals.delete(oldest);
    }
    return { [LOCAL_STATE_KEY]: key };
  };
  const localOf = (state: unknown): LocalInput | null => {
    const key = state && typeof state === "object" ? (state as Record<string, unknown>)[LOCAL_STATE_KEY] : undefined;
    return typeof key === "string" ? (locals.get(key) ?? null) : null;
  };

  const systemDark = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  const schemeOf = (s: StudioSettings): "light" | "dark" =>
    s.theme === "auto" ? (systemDark?.matches ? "dark" : "light") : s.theme;
  let scheme = schemeOf(settings);

  const viewport = watchViewport(win, html);
  const toast = createToaster();
  const slot = h("div", { class: "view-slot" });
  const skip = h("a", { class: "skip-link", attrs: { href: "#main" } });
  let settingsPanel: Panel | null = null;
  let shortcutsPanel: Panel | null = null;
  const panels = (): { settings: Panel; shortcuts: Panel } => {
    if (!settingsPanel || !shortcutsPanel) throw new Error("Studio panels are not built yet");
    return { settings: settingsPanel, shortcuts: shortcutsPanel };
  };

  const applyDocument = () => {
    html.lang = i18n.locale;
    html.dataset.theme = scheme;
    html.style.colorScheme = scheme;
    // Studio's own animations follow the Motion setting too, not only the player (see base.css).
    html.dataset.motion = settings.reducedMotion;
    let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = h("meta", { attrs: { name: "theme-color" } });
      doc.head.append(meta);
    }
    meta.content = THEME_COLOR[scheme];
    skip.textContent = i18n.t("app.skip");
  };

  const renderSettingsForm = () => {
    panels().settings.body.replaceChildren(
      settingsForm({
        i18n,
        settings,
        compact: html.dataset.view === "watch",
        onChange: (patch) => updateSettings(patch),
        onReset: () => {
          updateSettings({ ...DEFAULT_SETTINGS });
          renderSettingsForm();
        },
      }),
    );
  };

  const buildPanels = () => {
    settingsPanel?.destroy();
    shortcutsPanel?.destroy();
    const panel = createPanel({
      title: i18n.t("settings.title"),
      closeLabel: i18n.t("settings.close"),
      class: "panel-settings",
      onClose: () => {
        // A replaced panel closes asynchronously, possibly after its successor opened.
        if (settingsPanel === panel) html.dataset.drawer = "closed";
      },
    });
    settingsPanel = panel;
    shortcutsPanel = createShortcuts(i18n);
    html.dataset.drawer = "closed";
  };

  // A watch-sized screen gets the watch face unless the link asks for the file picker (`?import=1`).
  const isWatch = () => route.watch || (viewport.state.watch && !route.import);

  const renderView = () => {
    view?.destroy();
    const watch = isWatch();
    const name = watch ? "watch" : route.source ? "player" : "home";
    html.dataset.view = name;
    if (name !== "player") doc.title = i18n.t("app.name");
    const { settings: drawer } = panels();
    if (drawer.isOpen && name === "watch") drawer.close();
    view = name === "watch" ? createWatch(ctx) : route.source ? createPlayerView(ctx, route.source) : createHome(ctx);
    slot.replaceChildren(view.root);
    // Foldables: with a second segment to spare, the settings sit docked next to the stage.
    if (name === "player" && viewport.state.dual !== "none" && !drawer.isOpen) toggleSettings();
    if (navigated) {
      const target = view.root.id === "main" ? view.root : view.root.querySelector<HTMLElement>("#main");
      target?.focus({ preventScroll: true });
      win.scrollTo({ top: 0 });
    }
  };

  const mountShell = () => {
    applyDocument();
    buildPanels();
    const { settings: drawer, shortcuts } = panels();
    // Once mounted, the slot stays connected: detaching it would reset a running stage.
    if (slot.parentNode === root) slot.after(drawer.root, shortcuts.root, toast.root);
    else root.replaceChildren(skip, slot, drawer.root, shortcuts.root, toast.root);
  };

  const renderAll = () => {
    mountShell();
    renderView();
  };

  /** New strings are in: rebuild the shell, keep the view running when it can relabel itself. */
  const relocalize = () => {
    const reopen = panels().settings.isOpen;
    mountShell();
    // The player titles the tab after the document itself (and relabels it below).
    if (html.dataset.view !== "player") doc.title = i18n.t("app.name");
    // Reopened first, so anything the view announces lands above a modal sheet.
    if (reopen) toggleSettings();
    if (view?.localeChanged) view.localeChanged();
    else renderView();
  };

  function navigate(patch: Partial<Route>, opts: NavigateOptions = {}): void {
    const next: Route = {
      source: null,
      autoplay: false,
      watch: route.watch,
      round: route.round,
      import: false,
      overrides: route.overrides,
      ...patch,
    };
    // A local input belongs to the entry this navigation creates; other entries carry none.
    local = opts.local ?? null;
    const state = opts.local ? keepLocal(opts.local) : null;
    const url = routeToUrl(next, appUrl);
    try {
      if (opts.replace) win.history.replaceState(state, "", url);
      else win.history.pushState(state, "", url);
    } catch (error) {
      // Sandboxed or opaque origins can refuse history changes; the view still switches.
      console.warn("[studio] history update failed", error);
    }
    route = next;
    navigated = true;
    renderView();
  }

  function updateSettings(patch: Partial<StudioSettings>): void {
    const clean = sanitizeSettings(patch);
    const keys = Object.keys(clean) as (keyof StudioSettings)[];
    if (keys.every((key) => settings[key] === clean[key])) return;
    const prev = settings;
    stored = { ...stored, ...clean };
    saveSettings(services.storage, stored);
    // A setting the user changes stops being a per-visit URL override.
    const overrides = { ...route.overrides };
    for (const key of keys) delete overrides[key];
    route = { ...route, overrides };
    settings = { ...prev, ...clean };
    syncAssetPolicy();
    if (settings.remoteAssets && !prev.remoteAssets && assetsBlocked) {
      toast.show(i18n.t("settings.remote.reload"), {
        icon: "refresh",
        action: { label: i18n.t("update.reload"), run: () => win.location.reload() },
      });
    }
    const nextScheme = schemeOf(settings);
    const documentChanged = nextScheme !== scheme || prev.reducedMotion !== settings.reducedMotion;
    scheme = nextScheme;
    if (documentChanged) applyDocument();
    for (const el of doc.querySelectorAll<HTMLButtonElement>(".theme-button")) syncThemeButton(ctx, el);
    view?.settingsChanged?.(prev, settings);
    const locale = resolveLocale(settings.locale, win);
    if (locale === resolveLocale(prev.locale, win)) return;
    const request = ++localeRequest;
    void loadI18n(services, locale).then((next) => {
      if (destroyed || request !== localeRequest) return;
      i18n = next;
      relocalize();
    });
  }

  function toggleSettings(): void {
    const { settings: drawer } = panels();
    if (drawer.isOpen) {
      drawer.close();
      return;
    }
    renderSettingsForm();
    const state = viewport.state;
    // Phones get a modal bottom sheet; wide screens and foldables a drawer beside the content.
    const modal = state.dual === "none" && (state.compact || isWatch());
    html.dataset.drawer = modal ? "sheet" : "open";
    drawer.open(modal);
  }

  const formats = availableFormats(services.formats);
  const listFormat = (items: string[]): string => {
    try {
      return new Intl.ListFormat(i18n.locale, { type: "conjunction" }).format(items);
    } catch {
      return items.join(", ");
    }
  };

  const ctx: AppContext = {
    services,
    get i18n() {
      return i18n;
    },
    toast,
    viewport,
    get route() {
      return route;
    },
    get settings() {
      return settings;
    },
    get scheme() {
      return scheme;
    },
    get local() {
      return local;
    },
    appUrl,
    updateSettings,
    navigate,
    toggleSettings,
    settingsOpen: () => panels().settings.isOpen,
    openShortcuts: () => panels().shortcuts.open(true),
    formats,
    formatList: () => listFormat([...new Set(formats.map((m) => formatLabel(ctx, m.id)))]),
  };

  // Global listeners
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const { settings: drawer, shortcuts } = panels();
    if (event.key === "Escape" && drawer.isOpen && !drawer.isModal) {
      event.preventDefault();
      drawer.close();
      return;
    }
    if (shortcuts.isOpen || drawer.isModal) return;
    if (view?.onKey?.(event)) {
      event.preventDefault();
      return;
    }
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "?") {
      event.preventDefault();
      shortcuts.open(true);
    } else if ((event.key === "s" || event.key === "S") && !isWatch()) {
      event.preventDefault();
      toggleSettings();
    }
  };
  const onPop = (event: PopStateEvent) => {
    route = parseRoute(win.location.href, routeOptions);
    local = localOf(event.state);
    navigated = true;
    renderView();
  };
  const onSystemScheme = () => {
    if (settings.theme !== "auto") return;
    scheme = schemeOf(settings);
    applyDocument();
    view?.schemeChanged?.(scheme);
  };
  const offViewport = viewport.onChange(() => {
    if ((html.dataset.view === "watch") !== isWatch()) renderView();
    // A sheet left open while the screen grows (or unfolds) becomes a drawer, and back.
    const { settings: drawer } = panels();
    if (drawer.isOpen) {
      drawer.close();
      queueMicrotask(toggleSettings);
    }
  });
  win.addEventListener("keydown", onKey);
  win.addEventListener("popstate", onPop);
  systemDark?.addEventListener("change", onSystemScheme);

  // Files opened through the OS (`file_handlers`) arrive via the Launch Queue after load.
  let launchTimer = 0;
  if (route.source?.kind === "launch") {
    route = { ...route, source: null };
    launchTimer = win.setTimeout(() => navigate({ source: null }, { replace: true }), LAUNCH_WAIT_MS);
  }
  /** Opens the first launched file. One that cannot be read leaves `?launch=1` for home and says why. */
  const openLaunched = async (files: Promise<File[]>) => {
    let file: File | undefined;
    let input: LocalInput;
    try {
      file = (await files)[0];
      if (!file) return;
      win.clearTimeout(launchTimer);
      input = await readLocalFile(file);
    } catch (error) {
      console.warn("[studio] launch file unreadable", error);
      if (destroyed) return;
      win.clearTimeout(launchTimer);
      const waiting = parseRoute(win.location.href, routeOptions).source?.kind === "launch";
      if (waiting) navigate({ source: null }, { replace: true });
      toast.show(describeError(error, i18n, { formats: ctx.formatList(), label: file?.name }), { icon: "alert" });
      return;
    }
    if (destroyed) return;
    navigate({ source: { kind: "file", name: input.name }, autoplay: true }, { local: input, replace: true });
  };
  services.onLaunch?.((files) => void openLaunched(files));

  renderAll();

  return {
    context: ctx,
    toast,
    get view() {
      return view?.root ?? null;
    },
    destroy() {
      destroyed = true;
      locals.clear();
      win.clearTimeout(launchTimer);
      win.removeEventListener("keydown", onKey);
      win.removeEventListener("popstate", onPop);
      systemDark?.removeEventListener("change", onSystemScheme);
      offViewport();
      view?.destroy();
      view = null;
      settingsPanel?.destroy();
      shortcutsPanel?.destroy();
      toast.destroy();
      viewport.destroy();
      root.replaceChildren();
    },
  };
}
