/// <reference lib="webworker" />
/**
 * Studio service worker, hand-written and small:
 *  - precaches the app shell (HTML, entry chunks, CSS, icons, manifest) per release;
 *  - warms the lazy adapter and locale chunks at install (best effort), and caches every other
 *    hashed asset (pdf.js workers, legacy builds) on first use, cache-first;
 *  - serves examples stale-while-revalidate;
 *  - answers navigations from the cached shell, so Studio opens offline;
 *  - receives the PWA share target (POST) into a short-lived inbox the page reads (`?inbox=`).
 *
 * Updates wait until the page asks (`MSG_SKIP_WAITING`), so a running build is never cut off.
 * Remote files (other origins) are never cached.
 */

import {
  INBOX_CACHE,
  INBOX_HEADER,
  INBOX_MAX_AGE_MS,
  INBOX_MAX_BYTES,
  inboxKey,
  MSG_SKIP_WAITING,
  SHARE_TARGET_PATH,
} from "./protocol";

declare const self: ServiceWorkerGlobalScope;
/** Shell files relative to the scope, injected at build time. */
declare const __PRECACHE__: readonly string[];
/** Every hashed asset of this release, relative to the scope (to drop stale runtime entries). */
declare const __ASSETS__: readonly string[];
/** Lazy chunks fetched ahead at install (adapters, locales), relative to the scope. */
declare const __WARM__: readonly string[];
/** Content hash of the release. */
declare const __VERSION__: string;

const SHELL_PREFIX = "swarmloom-shell-";
const SHELL_CACHE = `${SHELL_PREFIX}${__VERSION__}`;
const ASSET_CACHE = "swarmloom-assets-v1";
const EXAMPLE_CACHE = "swarmloom-examples-v1";

const scope = self.registration.scope;
const indexUrl = new URL("./", scope).href;
const assetsUrl = new URL("assets/", scope).href;
const examplesUrl = new URL("examples/", scope).href;
const shareUrl = new URL(SHARE_TARGET_PATH, scope).href;

/**
 * Cache lookups ignore `Vary`. Every cached file is a same-origin static file, so no request header
 * changes its bytes; but hosts that answer with `Vary: Origin` (CORS middleware, some CDNs) would
 * otherwise make each lookup for a module chunk miss, since browsers send `Origin` when they load
 * one and the request the worker cached it with had none. Offline, every miss is a failed import.
 */
const LOOKUP: CacheQueryOptions = { ignoreVary: true };

/** Fetches the adapter chunks ahead; a failure only means that chunk is fetched on first use. */
async function warm(): Promise<void> {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(
    __WARM__.map(async (path) => {
      const url = new URL(path, scope).href;
      if (await cache.match(url, LOOKUP)) return;
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(__PRECACHE__.map((path) => new URL(path, scope).href)))
      .then(warm),
  );
});

async function cleanUp(): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
  }
  const current = new Set(__ASSETS__.map((path) => new URL(path, scope).href));
  const assets = await caches.open(ASSET_CACHE);
  for (const request of await assets.keys()) {
    if (!current.has(request.url)) await assets.delete(request);
  }
  const inbox = await caches.open(INBOX_CACHE);
  const now = Date.now();
  for (const request of await inbox.keys()) {
    const response = await inbox.match(request);
    const time = Number(response?.headers.get(INBOX_HEADER.time));
    if (!Number.isFinite(time) || now - time > INBOX_MAX_AGE_MS) await inbox.delete(request);
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanUp().then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data === MSG_SKIP_WAITING) void self.skipWaiting();
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const hit =
    (await caches.match(request, { ...LOOKUP, cacheName: SHELL_CACHE })) ??
    (await caches.match(request, { ...LOOKUP, cacheName }));
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const copy = response.clone();
    void caches.open(cacheName).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function staleWhileRevalidate(event: FetchEvent, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request, LOOKUP);
  const refresh = fetch(event.request).then((response) => {
    if (response.ok && response.type === "basic") void cache.put(event.request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(
      refresh.then(
        () => undefined,
        () => undefined,
      ),
    );
    return hit;
  }
  return refresh;
}

async function navigation(request: Request): Promise<Response> {
  const shell = await caches.match(indexUrl, { ...LOOKUP, cacheName: SHELL_CACHE });
  if (shell) return shell;
  try {
    return await fetch(request);
  } catch (error) {
    const fallback = await caches.match(indexUrl, LOOKUP);
    if (fallback) return fallback;
    throw error;
  }
}

function text(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, 1_000_000) : undefined;
}

/** Parks shared files and text in the inbox, then sends the page to `?inbox=<id>`. */
async function receiveShare(request: Request): Promise<Response> {
  const home = new URL("./", scope);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.redirect(home.href, 303);
  }
  const id = self.crypto.randomUUID();
  const cache = await caches.open(INBOX_CACHE);
  const time = String(Date.now());
  const title = text(form.get("title")) ?? "";
  let index = 0;
  const put = (body: BodyInit, headers: Record<string, string>) =>
    cache.put(inboxKey(scope, id, index++), new Response(body, { headers: { ...headers, [INBOX_HEADER.time]: time } }));
  for (const value of form.getAll("file")) {
    if (typeof value === "string" || value.size === 0 || value.size > INBOX_MAX_BYTES) continue;
    await put(value, {
      "content-type": value.type || "application/octet-stream",
      [INBOX_HEADER.kind]: "file",
      [INBOX_HEADER.name]: encodeURIComponent(value.name || "shared"),
    });
  }
  const url = text(form.get("url"));
  if (url) await put(url, { [INBOX_HEADER.kind]: "url", [INBOX_HEADER.title]: encodeURIComponent(title) });
  const body = text(form.get("text"));
  if (body) await put(body, { [INBOX_HEADER.kind]: "text", [INBOX_HEADER.title]: encodeURIComponent(title) });
  if (index === 0) return Response.redirect(home.href, 303);
  home.searchParams.set("inbox", id);
  home.searchParams.set("autoplay", "1");
  return Response.redirect(home.href, 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = request.url.split("#")[0] ?? request.url;
  if (request.method === "POST" && url.split("?")[0] === shareUrl) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET" || !url.startsWith(scope)) return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  if (url.startsWith(assetsUrl)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (url.startsWith(examplesUrl)) {
    event.respondWith(staleWhileRevalidate(event, EXAMPLE_CACHE));
    return;
  }
  event.respondWith(cacheFirst(request, ASSET_CACHE));
});
