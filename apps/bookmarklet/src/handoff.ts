import { MSG_PAGE, type PagePayload } from "./protocol";

/**
 * Opens the Studio in a new tab and sends `payload` to it whenever it asks.
 *
 * The Studio asks by posting the bare string {@link MSG_PAGE} to `window.opener`. The answer is
 * always posted to the window we opened with the Studio origin as `targetOrigin`, so the browser
 * delivers it only while that window shows a Studio-origin document; a request from anywhere
 * else can at most make us re-send the page to the same Studio tab. The listener stays
 * registered while the page is open, so a reloaded Studio tab can ask again (it costs one
 * retained copy of the payload).
 *
 * This code ships inside the size-limited loader: keep it small and dependency-free.
 *
 * @param w Window of the page; the Studio is opened from it (it becomes `window.opener`).
 * @param studio Absolute Studio URL, normally ending in `?from=bookmarklet`.
 * @param payload Serialized page.
 * @returns The Studio window, or null when the popup was blocked (call again from a click handler).
 */
export function handoffToStudio(w: Window, studio: URL, payload: PagePayload): Window | null {
  const popup = w.open(studio);
  if (popup) w.addEventListener("message", (e) => e.data === MSG_PAGE && popup.postMessage(payload, studio.origin));
  return popup;
}
