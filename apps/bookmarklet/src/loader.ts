import { handoffToStudio } from "./handoff";
import { type BookmarkletHandle, GLOBAL_KEY, type HandoffReason, SCRIPT_ID } from "./protocol";
import { serializePage } from "./serialize";

/** Build-time configuration of the loader. */
export interface LoaderConfig {
  /** Absolute URL of the hosted module bundle (`swarm.js`). Must be served with CORS. */
  bundleUrl: string;
  /** Studio URL for the fallback, absolute or relative to `bundleUrl`; ends in `?from=bookmarklet`. */
  studioUrl: string;
  /** Option string copied to the script's `data-swarmloom-bm` attribute (see options.ts). */
  options: string;
  /** How long to wait for the bundle before falling back to the Studio, ms. */
  timeout: number;
}

/**
 * Body of the bookmarklet.
 *
 * 1. If the hosted bundle already runs on this page, toggle it (start again or stop).
 * 2. Remove what a previous click left behind (a script still loading, or the "Open in Studio"
 *    button), so a second click retries cleanly instead of stacking attempts.
 * 3. Inject the bundle as a module script. When the page's Content Security Policy or Trusted
 *    Types block it (securitypolicyviolation, a thrown assignment, a load error or a timeout),
 *    serialize the page and hand it to the Studio instead. If the browser blocks the Studio popup,
 *    show a button so the user can open it with a real click.
 *
 * Every signal funnels into one guarded fallback that does nothing once the script element is
 * gone: the bundle removes it when it starts, a later click removes it, the first fallback
 * removes it. That makes listener and timer cleanup unnecessary, which matters because the
 * minified loader must stay under 1.5 KB.
 *
 * Elements are appended to `<html>` itself: it always exists, and unlike `<head>` it is rendered.
 *
 * @param w Window of the page the bookmarklet runs on.
 * @param d Document of that window.
 * @param c Build-time configuration.
 */
export function runLoader(w: Window, d: Document, c: LoaderConfig): void {
  const running = (w as unknown as Record<string, BookmarkletHandle | undefined>)[GLOBAL_KEY];
  if (running) {
    running.toggle(c.options);
    return;
  }
  d.getElementById(SCRIPT_ID)?.remove();

  const root = d.documentElement;
  const script = d.createElement("script");
  const studio = new URL(c.studioUrl, c.bundleUrl);
  const fallback = (reason: HandoffReason) => {
    if (!script.isConnected) return;
    script.remove();
    const payload = serializePage(w, d, reason);
    if (handoffToStudio(w, studio, payload)) return;
    const button = d.createElement("button");
    button.id = SCRIPT_ID;
    button.textContent = "Open in SwarmLoom Studio";
    // CSSOM writes are allowed under a style-src CSP, unlike style attributes in markup.
    button.style.cssText = "position:fixed;top:0;z-index:2147483647;font-size:18px";
    button.onclick = () => {
      button.remove();
      handoffToStudio(w, studio, payload);
    };
    root.append(button);
    button.focus();
  };
  w.setTimeout(fallback, c.timeout, "timeout");
  // Report-only policies block nothing, and other violations belong to the page itself. Browsers
  // that report only the origin as blockedURI still fall back, through the error event.
  d.addEventListener("securitypolicyviolation", (e) => {
    if (e.disposition === "enforce" && e.blockedURI === c.bundleUrl) fallback("blocked");
  });
  script.id = SCRIPT_ID;
  script.type = "module";
  script.dataset[SCRIPT_ID] = c.options;
  script.onerror = () => fallback("error");
  // Connect first, then set src (which starts the fetch): Trusted Types throw on the assignment.
  root.append(script);
  try {
    script.src = c.bundleUrl;
  } catch {
    fallback("blocked");
  }
}
