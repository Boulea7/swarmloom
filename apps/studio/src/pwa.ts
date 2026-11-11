import type { StudioI18n } from "./i18n";
import type { InboxItem } from "./services";
import { INBOX_CACHE, INBOX_HEADER, INBOX_PREFIX, MSG_SKIP_WAITING } from "./sw/protocol";
import type { Toaster } from "./ui/toast";

function header(response: Response, name: string): string {
  try {
    return decodeURIComponent(response.headers.get(name) ?? "");
  } catch {
    return "";
  }
}

/**
 * Reads and removes the items the service worker parked for share-target inbox `id`.
 * Returns an empty list when the inbox is gone (already read, expired, or no Cache API).
 */
export async function readInbox(id: string, scope: string): Promise<InboxItem[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(INBOX_CACHE);
  const prefix = new URL(`${INBOX_PREFIX}${encodeURIComponent(id)}/`, scope).href;
  const requests = (await cache.keys()).filter((r) => r.url.startsWith(prefix));
  requests.sort((a, b) => Number(a.url.slice(prefix.length)) - Number(b.url.slice(prefix.length)));
  const items: InboxItem[] = [];
  for (const request of requests) {
    const response = await cache.match(request);
    if (!response) continue;
    const kind = response.headers.get(INBOX_HEADER.kind);
    if (kind === "file") {
      const blob = await response.blob();
      items.push({
        kind: "file",
        file: new File([blob], header(response, INBOX_HEADER.name) || "shared", { type: blob.type }),
      });
    } else if (kind === "url") {
      items.push({ kind: "url", url: await response.text(), title: header(response, INBOX_HEADER.title) || undefined });
    } else if (kind === "text") {
      items.push({
        kind: "text",
        text: await response.text(),
        title: header(response, INBOX_HEADER.title) || undefined,
      });
    }
  }
  await Promise.all(requests.map((r) => cache.delete(r)));
  return items;
}

/**
 * Registers the service worker and keeps the user in charge of updates: a new version waits until
 * the user picks "Reload" in a toast, so a running build is never interrupted.
 */
export function registerServiceWorker(win: Window, toast: Toaster, i18n: () => StudioI18n, url = "./sw.js"): void {
  const container = win.navigator.serviceWorker;
  if (!container) return;
  const hadController = Boolean(container.controller);
  let reloading = false;
  container.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    win.location.reload();
  });
  const offerUpdate = (worker: ServiceWorker) => {
    toast.show(i18n().t("update.ready"), {
      icon: "refresh",
      action: { label: i18n().t("update.reload"), run: () => worker.postMessage(MSG_SKIP_WAITING) },
    });
  };
  container.register(url, { scope: "./" }).then(
    (registration) => {
      if (registration.waiting && hadController) offerUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state !== "installed") return;
          if (hadController) offerUpdate(worker);
          else toast.show(i18n().t("offline.ready"), { icon: "check" });
        });
      });
    },
    (error: unknown) => console.warn("[studio] service worker registration failed", error),
  );
}
