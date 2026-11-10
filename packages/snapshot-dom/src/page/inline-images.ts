import type { Blueprint, Layer } from "@swarmloom/core";
import { throwIfAborted } from "../util/abort";
import { extractUrls, rewriteUrls } from "../util/css";

/** Per-image and total byte budgets for inlined images. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const FETCH_TIMEOUT = 5000;
const CONCURRENCY = 6;

const SRC_ATTR = /(<img\b[^>]*?\ssrc=")([^"]*)(")/g;

function unescapeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True for URLs the snapshot may fetch: same-origin http(s) and blob: URLs. */
export function isInlinable(url: string, pageOrigin: string): boolean {
  if (url.startsWith("blob:")) return true;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === pageOrigin;
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function urlsOf(layer: Layer): string[] {
  switch (layer.kind) {
    case "image":
      return [layer.src];
    case "media":
      return layer.src ? [layer.src] : [];
    case "text":
      return [...layer.html.matchAll(SRC_ATTR)].map((m) => unescapeAttr(m[2] ?? ""));
    case "box":
      return [...extractUrls(layer.style["background-image"] ?? ""), ...extractUrls(layer.style["mask-image"] ?? "")];
    default:
      return [];
  }
}

function replaceIn(layer: Layer, map: ReadonlyMap<string, string>): void {
  const sub = (u: string) => map.get(u) ?? u;
  switch (layer.kind) {
    case "image":
      layer.src = sub(layer.src);
      return;
    case "media":
      if (layer.src) layer.src = sub(layer.src);
      return;
    case "text":
      layer.html = layer.html.replace(
        SRC_ATTR,
        (_all, pre: string, url: string, post: string) => `${pre}${escapeAttr(sub(unescapeAttr(url)))}${post}`,
      );
      return;
    case "box":
      for (const key of ["background-image", "mask-image", "-webkit-mask-image"]) {
        const v = layer.style[key];
        if (v) layer.style[key] = rewriteUrls(v, sub);
      }
      return;
    default:
  }
}

async function fetchDataUrl(view: Window, url: string, signal: AbortSignal | undefined): Promise<string | null> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await view.fetch(url, { signal: ctrl.signal, credentials: "same-origin" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/")) return null;
    const blob = await res.blob();
    if (blob.size > MAX_IMAGE_BYTES) return null;
    return await blobToDataUrl(blob);
  } catch {
    // Network errors and timeouts keep the original URL.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Replaces same-origin image URLs (image/media layers, `<img>` in text, box backgrounds and the
 * icon) with data: URLs so the blueprint plays in another document. Images that fail, are too
 * large or exceed the total budget keep their URL. Returns the number of URLs inlined.
 */
export async function inlineImages(doc: Document, bp: Blueprint, signal?: AbortSignal): Promise<number> {
  const view = doc.defaultView;
  if (!view || typeof view.fetch !== "function") return 0;
  let origin: string;
  try {
    origin = new URL(doc.URL).origin;
  } catch {
    origin = "null";
  }
  const wanted = new Set<string>();
  for (const layer of bp.layers) for (const u of urlsOf(layer)) if (isInlinable(u, origin)) wanted.add(u);
  if (bp.icon && isInlinable(bp.icon, origin)) wanted.add(bp.icon);
  const map = new Map<string, string>();
  const queue = [...wanted];
  let total = 0;
  const worker = async () => {
    while (queue.length > 0 && total < MAX_TOTAL_BYTES) {
      throwIfAborted(signal);
      const url = queue.shift() as string;
      const data = await fetchDataUrl(view, url, signal);
      if (data && total + data.length <= MAX_TOTAL_BYTES) {
        total += data.length;
        map.set(url, data);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  throwIfAborted(signal);
  if (map.size === 0) return 0;
  for (const layer of bp.layers) replaceIn(layer, map);
  if (bp.icon) bp.icon = map.get(bp.icon) ?? bp.icon;
  return map.size;
}
