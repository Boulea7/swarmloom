// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const SCOPE = "https://studio.test/";
/** Kept out of the type-checked program: the worker is built against the WebWorker lib. */
const SW_ENTRY = new URL("../src/sw/sw.ts", import.meta.url).href;

type Key = string | { url: string };
const urlOf = (key: Key) => (typeof key === "string" ? key : key.url);

/** Cache Storage in memory, as far as the worker uses it (lookups go by URL alone). */
function memoryCaches() {
  const store = new Map<string, Map<string, Response>>();
  const entries = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name) as Map<string, Response>;
  };
  return {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (key: Key, options?: { cacheName?: string }) => {
      for (const [name, cache] of store) {
        const hit = options?.cacheName && options.cacheName !== name ? undefined : cache.get(urlOf(key));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    open: async (name: string) => {
      const cache = entries(name);
      return {
        match: async (key: Key) => cache.get(urlOf(key))?.clone(),
        put: async (key: Key, response: Response) => void cache.set(urlOf(key), response),
        delete: async (key: Key) => cache.delete(urlOf(key)),
        keys: async () => [...cache.keys()].map((url) => ({ url })),
        addAll: async (urls: string[]) => {
          for (const url of urls) cache.set(url, await fetch(url));
        },
      };
    },
  };
}

interface Release {
  version: string;
  shell: string[];
  lazy: string[];
}

/** The host serves one release at a time; files of earlier ones are gone (404). */
let hosted = new Map<string, string>();
const host = (release: Release) => {
  hosted = new Map([...release.shell, ...release.lazy].map((path) => [new URL(path, SCOPE).href, release.version]));
};

/** Loads, installs and activates the worker of `release` while the windows `open()` lists are open. */
async function activateWorker(release: Release, open: () => string[]) {
  const handlers = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("self", {
    registration: { scope: SCOPE },
    clients: {
      matchAll: async () => open().map((id) => ({ id, url: SCOPE, type: "window" })),
      claim: async () => undefined,
    },
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
  });
  vi.stubGlobal("__PRECACHE__", release.shell);
  vi.stubGlobal("__WARM__", release.lazy);
  vi.stubGlobal("__WARM_PDF__", { modern: [], legacy: [] });
  const assets = [...release.shell, ...release.lazy].filter((path) => path.startsWith("assets/"));
  vi.stubGlobal("__ASSETS__", assets);
  vi.stubGlobal("__VERSION__", release.version);
  vi.resetModules();
  await import(/* @vite-ignore */ SW_ENTRY);
  const dispatch = async (type: string, event: object = {}) => {
    const work: unknown[] = [];
    handlers.get(type)?.({ ...event, waitUntil: (promise: unknown) => work.push(promise) });
    await Promise.all(work);
  };
  await dispatch("install");
  await dispatch("activate");
  return {
    /** A page's request for `path`: the response once the worker's follow-up work has finished too. */
    async get(path: string): Promise<Response | undefined> {
      let response: Promise<Response> | undefined;
      const request = { url: new URL(path, SCOPE).href, method: "GET", mode: "cors" };
      await dispatch("fetch", { request, respondWith: (value: Promise<Response>) => (response = value) });
      return response;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio service worker", () => {
  it("keeps an older release's files until the windows open at the update are gone", async () => {
    const caches = memoryCaches();
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("fetch", async (key: Key) => {
      const body = hosted.get(urlOf(key));
      return body === undefined ? new Response("", { status: 404 }) : new Response(body);
    });
    const a = { version: "a", shell: ["./", "assets/index-a.js"], lazy: ["assets/pdf-a.js"] };
    const b = { version: "b", shell: ["./", "assets/index-b.js"], lazy: ["assets/pdf-b.js"] };
    let windows = ["tab-1", "tab-2"];
    host(a);
    await activateWorker(a, () => windows);
    // Release b goes live and takes over (tab-1 picked Reload); tab-2 keeps running release a.
    host(b);
    const worker = await activateWorker(b, () => windows);
    windows = ["tab-1b", "tab-2"];
    for (const path of ["assets/pdf-a.js", "assets/index-a.js", "assets/pdf-b.js"]) {
      const response = await worker.get(path);
      expect([path, response?.status, await response?.text()]).toEqual([path, 200, path.endsWith("-a.js") ? "a" : "b"]);
    }
    // Once tab-2 reloads, release a goes.
    windows = ["tab-1b", "tab-2b"];
    await worker.get("assets/index-b.js");
    const assets = await caches.open("swarmloom-assets-v1");
    expect(await caches.keys()).not.toContain("swarmloom-shell-a");
    expect((await assets.keys()).map((request) => request.url)).toEqual([`${SCOPE}assets/pdf-b.js`]);
  });
});
