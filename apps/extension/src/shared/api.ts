/**
 * Minimal typed view of the WebExtension APIs SwarmLoom uses, plus a namespace shim.
 *
 * Firefox and Safari expose promise-based `browser.*`; Chromium MV3 exposes promise-based `chrome.*`.
 * Every call we make exists with the same shape in both, so the shim only picks the namespace and
 * maps the MV2 `browserAction` / Firefox `menus` aliases. No polyfill is bundled.
 */

export interface Tab {
  id?: number;
  index: number;
  windowId: number;
  active: boolean;
  /** Present only when the extension has access to the tab (activeTab grant or host permission). */
  url?: string;
  title?: string;
}

export interface ExtEvent<F extends (...args: never[]) => unknown> {
  addListener(fn: F): void;
  removeListener(fn: F): void;
}

export interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ActionApi {
  setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  getBadgeText?(details: { tabId?: number }): Promise<string>;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
  setTitle(details: { title: string; tabId?: number }): Promise<void>;
  onClicked: ExtEvent<(tab: Tab) => void>;
}

export type MenuContext = "page" | "selection" | "link" | "image" | "video" | "audio" | "frame" | "editable";

export interface MenuCreateProperties {
  id: string;
  title: string;
  contexts: MenuContext[];
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
}

export interface MenuClickInfo {
  menuItemId: string | number;
  pageUrl?: string;
  frameId?: number;
  frameUrl?: string;
  linkUrl?: string;
  srcUrl?: string;
  selectionText?: string;
  /** Firefox only: resolve with `menus.getTargetElement` in a content script. */
  targetElementId?: number;
}

export interface MenusApi {
  create(props: MenuCreateProperties, callback?: () => void): number | string;
  removeAll(): Promise<void>;
  onClicked: ExtEvent<(info: MenuClickInfo, tab?: Tab) => void>;
  /** Firefox content scripts only. */
  getTargetElement?(targetElementId: number): Element | null;
}

export interface InjectionTarget {
  tabId: number;
  frameIds?: number[];
}

export interface ScriptInjection {
  target: InjectionTarget;
  files?: string[];
  func?: (...args: never[]) => unknown;
  args?: unknown[];
}

export interface InjectionResult {
  frameId: number;
  result?: unknown;
}

export interface ManifestInfo {
  manifest_version: number;
  version: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  optional_permissions?: string[];
}

export interface MessageSender {
  id?: string;
  tab?: Tab;
  frameId?: number;
  url?: string;
}

/** `runtime.onMessage` listener; return true to answer asynchronously through `sendResponse`. */
export type MessageListener = (
  message: unknown,
  sender: MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

export interface ExtensionApi {
  runtime: {
    id: string;
    lastError?: { message?: string } | null;
    getURL(path: string): string;
    getManifest(): ManifestInfo;
    openOptionsPage(): Promise<void>;
    /** Operating system of the browser ("android", "ios", "mac", "win", "linux", ...). */
    getPlatformInfo?(): Promise<{ os: string }>;
    sendMessage(message: unknown): Promise<unknown>;
    onInstalled: ExtEvent<(details: { reason: string; previousVersion?: string }) => void>;
    onStartup: ExtEvent<() => void>;
    onMessage: ExtEvent<MessageListener>;
  };
  tabs: {
    create(props: { url: string; active?: boolean; index?: number; openerTabId?: number }): Promise<Tab>;
    get(tabId: number): Promise<Tab>;
    getCurrent?(): Promise<Tab | undefined>;
    query?(query: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    captureVisibleTab?(windowId: number, options: { format: "png" | "jpeg"; quality?: number }): Promise<string>;
  };
  scripting?: { executeScript(injection: ScriptInjection): Promise<InjectionResult[]> };
  action?: ActionApi;
  browserAction?: ActionApi;
  contextMenus?: MenusApi;
  menus?: MenusApi;
  storage: {
    local: StorageArea;
    sync?: StorageArea;
    onChanged?: ExtEvent<(changes: Record<string, unknown>, areaName: string) => void>;
  };
  commands?: {
    getAll?(): Promise<{ name?: string; shortcut?: string }[]>;
    /** Firefox 137+. */
    openShortcutSettings?(): Promise<void>;
  };
  permissions?: { request(permissions: { origins?: string[] }): Promise<boolean> };
  extension?: { isAllowedFileSchemeAccess?(): Promise<boolean> };
  i18n: { getMessage(key: string, substitutions?: string | string[]): string; getUILanguage(): string };
  sidePanel?: { open?(options: { tabId?: number; windowId?: number }): Promise<void> };
}

interface NamespaceHolder {
  browser?: unknown;
  chrome?: unknown;
}

function looksLikeApi(ns: unknown): ns is ExtensionApi {
  const runtime = (ns as { runtime?: { id?: unknown } } | undefined)?.runtime;
  return typeof runtime?.id === "string";
}

/**
 * Returns the extension namespace (`browser` first, then `chrome`), or null outside an extension
 * context (for example the bundled demo page served over plain HTTP in tests).
 */
export function getApi(scope: NamespaceHolder = globalThis as NamespaceHolder): ExtensionApi | null {
  if (looksLikeApi(scope.browser)) return scope.browser;
  if (looksLikeApi(scope.chrome)) return scope.chrome;
  return null;
}

/** MV3 `action` or MV2 `browserAction`. */
export function actionApi(api: ExtensionApi): ActionApi | undefined {
  return api.action ?? api.browserAction;
}

/** Chromium/Safari `contextMenus` or Firefox `menus`. */
export function menusApi(api: ExtensionApi): MenusApi | undefined {
  return api.contextMenus ?? api.menus;
}

/** Short message for logs and UI from anything thrown by an extension API. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String((error as { message?: unknown } | null)?.message ?? error);
}
