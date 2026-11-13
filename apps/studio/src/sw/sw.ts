/// <reference lib="webworker" />
/**
 * Studio service worker, hand-written and small:
 *  - precaches the app shell (HTML, entry chunks, CSS, icons, manifest) per release;
 *  - warms the lazy adapter, locale and video exporter chunks with what they load (pdf.js and its
 *    worker in the one build this engine runs) at install (best effort), and caches every other
 *    hashed asset (the other pdf.js build, three's Draco decoders) on first use, cache-first;
 *  - serves examples stale-while-revalidate;
 *  - answers navigations from the cached shell, so Studio opens offline;
 *  - receives the PWA share target (POST) into a short-lived inbox the page reads (`?inbox=`).
 *
 * The worker installs on the first visit to the hosted Studio, not only when the app is installed,
 * so every visitor gets the warm-up (the Studio docs' "Offline use" section says so).
 * Updates wait until the page asks (`MSG_SKIP_WAITING`), so a running build is never cut off.
 * Windows already open then keep the page they opened with, so an older release's shell and
 * assets stay cached until each of those windows has closed or reloaded: their lazy chunks (an
 * adapter, the exporter) still load, offline too, after the host dropped them. Only the newest
 * release drops files: a worker with a newer one installing, waiting or already active (it took over
 * while the older one was still tidying) leaves the newer files alone (they are not in its lists)
 * and the clean-up to that worker, which takes over without reinstalling.
 * Remote files (other origins) are never cached.
 */

import { type PdfBuild, pdfBuild } from "./pdf-build";
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
/**
 * Lazy chunks and the files they load, fetched ahead at install (adapters, locales, the video
 * exporter), relative to the scope.
 */
declare const __WARM__: readonly string[];
/** pdf.js's files of each build, relative to the scope; only the build this engine runs is fetched ahead. */
declare const __WARM_PDF__: Readonly<Record<PdfBuild, readonly string[]>>;
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
/** Every hashed asset of this release, as URLs. */
const RELEASE_ASSETS = new Set(__ASSETS__.map((path) => new URL(path, scope).href));

/**
 * Cache lookups ignore `Vary`. Every cached file is a same-origin static file, so no request header
 * changes its bytes; but hosts that answer with `Vary: Origin` (CORS middleware, some CDNs) would
 * otherwise make each lookup for a module chunk miss, since browsers send `Origin` when they load
 * one and the request the worker cached it with had none. Offline, every miss is a failed import.
 */
const LOOKUP: CacheQueryOptions = { ignoreVary: true };

/**
 * Key, in this release's shell cache, of the ids of the Studio windows open when it took over (a
 * JSON list). Older releases are dropped once none of them is open any more.
 */
const OLD_WINDOWS_URL = new URL("__old-windows", scope).href;

/** pdf.js's files in the build this engine runs, the only one the PDF reader loads here. */
const WARM_PDF = __WARM_PDF__[pdfBuild()];

/** Fetches `paths` ahead unless cached; a failure only means that file is fetched on first use. */
async function warm(paths: readonly string[]): Promise<void> {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(
    paths.map(async (path) => {
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
      .then(() => warm([...__WARM__, ...WARM_PDF])),
  );
});

/** Ids of the Studio windows open now, whichever worker controls them (or none). */
async function openWindows(): Promise<string[]> {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.filter((client) => client.url.startsWith(scope)).map((client) => client.id);
}

/**
 * This worker, noted once it runs as the registration's active one (activate and fetch events reach
 * only that one). `self.serviceWorker` where the engine has it, else `registration.active` then.
 */
let thisWorker: ServiceWorker | null = null;
function noteActive(): void {
  thisWorker ??= (self.serviceWorker as ServiceWorker | undefined) ?? self.registration.active;
}

/**
 * Whether a newer release is installing, waiting or has taken over from this one. Its shell and its
 * assets are not in this release's lists, and it does not install again when it takes over (offline
 * too), so they stay.
 */
function newerRelease(): boolean {
  const { installing, waiting, active } = self.registration;
  return Boolean(installing ?? waiting) || active !== thisWorker;
}

/**
 * Drops the shells of older releases and the assets this release does not list. Stops, returning
 * false, once a newer release is installing, waiting or active: it drops this release's files after it.
 */
async function dropOldReleases(): Promise<boolean> {
  for (const name of await caches.keys()) {
    if (newerRelease()) return false;
    if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
  }
  const assets = await caches.open(ASSET_CACHE);
  for (const request of await assets.keys()) {
    if (newerRelease()) return false;
    if (!RELEASE_ASSETS.has(request.url)) await assets.delete(request);
  }
  return true;
}

/** Drops share-target items nobody picked up in time. */
async function expireInbox(): Promise<void> {
  const inbox = await caches.open(INBOX_CACHE);
  const now = Date.now();
  for (const request of await inbox.keys()) {
    const response = await inbox.match(request);
    const time = Number(response?.headers.get(INBOX_HEADER.time));
    if (!Number.isFinite(time) || now - time > INBOX_MAX_AGE_MS) await inbox.delete(request);
  }
}

/** In memory only: after a restart, the record under OLD_WINDOWS_URL says what is still awaited. */
let tidied = false;
let tidying: Promise<void> | undefined;

/** Drops older releases once every window open at activation has closed or reloaded. */
function tidy(): Promise<void> {
  if (tidied) return Promise.resolve();
  tidying ??= (async () => {
    const shell = await caches.open(SHELL_CACHE);
    const record = await shell.match(OLD_WINDOWS_URL);
    if (record) {
      const open = new Set(await openWindows());
      if (((await record.json()) as string[]).some((id) => open.has(id))) return;
      if (!(await dropOldReleases())) return;
      await shell.delete(OLD_WINDOWS_URL);
    }
    tidied = true;
  })().finally(() => {
    tidying = undefined;
  });
  return tidying;
}

async function activate(): Promise<void> {
  noteActive();
  // Read before claiming: every Studio window open now runs an older release (or none yet).
  const old = await openWindows();
  await (await caches.open(SHELL_CACHE)).put(OLD_WINDOWS_URL, new Response(JSON.stringify(old)));
  // With none open, this drops older releases now (or, a newer one pending, leaves the record).
  await tidy();
  await expireInbox();
  await self.clients.claim();
}

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

self.addEventListener("message", (event) => {
  if (event.data === MSG_SKIP_WAITING) void self.skipWaiting();
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  // This release first; then any cache, for a window still on an older release (see tidy).
  const hit =
    (await caches.match(request, { ...LOOKUP, cacheName: SHELL_CACHE })) ??
    (await caches.match(request, { ...LOOKUP, cacheName })) ??
    (await caches.match(request, LOOKUP));
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
  noteActive();
  event.waitUntil(tidy());
  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    // A browser update can switch the PDF reader to the other pdf.js build between two releases of
    // this worker; fetch that build ahead while online (only missing files are fetched).
    event.waitUntil(warm(WARM_PDF));
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
