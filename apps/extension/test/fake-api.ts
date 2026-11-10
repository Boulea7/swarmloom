/**
 * In-memory stand-in for the WebExtension API, shared by the unit tests. `executeScript({ func })`
 * serializes and re-creates the function like the browser does, then runs it against `globalThis`
 * (the test's stand-in for the tab's isolated world); `files` injections call `onFile`.
 */

import type {
  ActionApi,
  ExtensionApi,
  InjectionResult,
  MenuCreateProperties,
  MessageListener,
  ScriptInjection,
  StorageArea,
  Tab,
} from "../src/shared/api";

export interface FakeOptions {
  /** Omit `contextMenus`/`menus` (Firefox Android, Safari iOS). */
  menus?: boolean;
  /** Omit `scripting`. */
  scripting?: boolean;
  /** Throw this message from every executeScript call. */
  injectionError?: string;
  /** Called for `files` injections. */
  onFile?: (file: string) => void;
  sync?: boolean;
  /** `runtime.getPlatformInfo().os`; omitted means the API is absent. */
  platform?: string;
}

export interface Fake {
  api: ExtensionApi;
  /** Every executeScript call: function name or file name. */
  injections: string[];
  createdTabs: { url: string; openerTabId?: number }[];
  badge: Map<number, { text: string; title: string; color?: string }>;
  menus: MenuCreateProperties[];
  sentMessages: unknown[];
  local: Map<string, unknown>;
  sync: Map<string, unknown>;
  listeners: { message: MessageListener[] };
}

function event<F extends (...args: never[]) => unknown>(store: F[] = []) {
  return { addListener: (fn: F) => void store.push(fn), removeListener: () => undefined };
}

function area(map: Map<string, unknown>): StorageArea {
  return {
    get: async (key) => {
      const keys = typeof key === "string" ? [key] : Array.isArray(key) ? key : [...map.keys()];
      return Object.fromEntries(keys.filter((k) => map.has(k)).map((k) => [k, structuredClone(map.get(k))]));
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) map.set(k, structuredClone(v));
    },
  };
}

/** Builds a fake API rooted at `chrome-extension://fake/`. */
export function createFake(opts: FakeOptions = {}): Fake {
  const injections: string[] = [];
  const createdTabs: Fake["createdTabs"] = [];
  const badge: Fake["badge"] = new Map();
  const menus: MenuCreateProperties[] = [];
  const sentMessages: unknown[] = [];
  const local = new Map<string, unknown>();
  const sync = new Map<string, unknown>();
  const listeners = { message: [] as MessageListener[] };

  const entry = (tabId: number) => {
    const current = badge.get(tabId) ?? { text: "", title: "" };
    badge.set(tabId, current);
    return current;
  };
  const action: ActionApi = {
    onClicked: event(),
    setBadgeText: async ({ tabId, text }) => {
      if (tabId !== undefined) entry(tabId).text = text;
    },
    setBadgeBackgroundColor: async ({ tabId, color }) => {
      if (tabId !== undefined) entry(tabId).color = color;
    },
    setTitle: async ({ tabId, title }) => {
      if (tabId !== undefined) entry(tabId).title = title;
    },
    getBadgeText: async ({ tabId }) => (tabId !== undefined ? (badge.get(tabId)?.text ?? "") : ""),
  };

  const scripting = {
    async executeScript(injection: ScriptInjection): Promise<InjectionResult[]> {
      if (opts.injectionError) throw new Error(opts.injectionError);
      if (injection.func) {
        injections.push(injection.func.name);
        // Rebuild the function from its source, as the browser does: any captured outer variable
        // or import becomes a ReferenceError here.
        const isolated = new Function(`return (${injection.func.toString()});`)() as (...args: unknown[]) => unknown;
        return [{ frameId: 0, result: isolated(...(injection.args ?? [])) }];
      }
      for (const file of injection.files ?? []) {
        injections.push(file);
        opts.onFile?.(file);
      }
      return [{ frameId: 0, result: undefined }];
    },
  };

  const menusApi = {
    create: (props: MenuCreateProperties, done?: () => void) => {
      menus.push(props);
      done?.();
      return props.id;
    },
    removeAll: async () => void menus.splice(0),
    onClicked: event(),
  };

  const api = {
    runtime: {
      id: "fake-id",
      lastError: null,
      getURL: (path: string) => `chrome-extension://fake/${path.replace(/^\//, "")}`,
      getManifest: () => ({ manifest_version: 3, version: "0.1.0", optional_host_permissions: ["<all_urls>"] }),
      openOptionsPage: async () => undefined,
      ...(opts.platform === undefined ? {} : { getPlatformInfo: async () => ({ os: opts.platform }) }),
      sendMessage: async (message: unknown) => void sentMessages.push(message),
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(listeners.message),
    },
    tabs: {
      create: async (props: { url: string; openerTabId?: number }) => {
        createdTabs.push({ url: props.url, openerTabId: props.openerTabId });
        return { id: 100 + createdTabs.length, index: 0, windowId: 1, active: true, url: props.url };
      },
      get: async (tabId: number): Promise<Tab> => ({ id: tabId, index: 0, windowId: 1, active: true }),
      captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
    },
    action,
    storage: { local: area(local), ...(opts.sync === false ? {} : { sync: area(sync) }), onChanged: event() },
    permissions: { request: async () => true },
    extension: { isAllowedFileSchemeAccess: async () => false },
    i18n: { getMessage: (key: string) => key, getUILanguage: () => "en-US" },
    ...(opts.scripting === false ? {} : { scripting }),
    ...(opts.menus === false ? {} : { contextMenus: menusApi }),
  } as unknown as ExtensionApi;

  return { api, injections, createdTabs, badge, menus, sentMessages, local, sync, listeners };
}

/** A tab in window 1 at `url`. */
export function tab(url: string | undefined, id = 7): Tab {
  return { id, index: 3, windowId: 1, active: true, url };
}
