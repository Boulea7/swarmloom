/** Small environment helpers shared by the client modules. */

const reducedQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** True when the user asked for reduced motion. Read on demand so a live OS change is honoured. */
export function prefersReducedMotion(): boolean {
  return reducedQuery?.matches ?? false;
}

/** Subscribes to reduced-motion changes. */
export function onReducedMotionChange(listener: (reduced: boolean) => void): void {
  reducedQuery?.addEventListener("change", (event) => listener(event.matches));
}

/** True when the user enabled data saving (Chromium only; other browsers report nothing). */
export function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: unknown } }).connection;
  return connection?.saveData === true;
}

/** Runs a callback once the main thread is idle, with a timeout so it always runs eventually. */
export function whenIdle(callback: () => void, timeout = 2000): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => callback(), { timeout });
  } else {
    setTimeout(callback, 200);
  }
}

/** Runs a callback after the load event (immediately if it already fired). */
export function afterLoad(callback: () => void): void {
  if (document.readyState === "complete") callback();
  else addEventListener("load", () => callback(), { once: true });
}

/** One shared live region for short status messages (copy feedback). */
let liveRegion: HTMLElement | null = null;

export function announce(message: string): void {
  if (!liveRegion) {
    liveRegion = document.createElement("p");
    liveRegion.className = "sr-only";
    liveRegion.setAttribute("aria-live", "polite");
    document.body.append(liveRegion);
  }
  liveRegion.textContent = "";
  // A separate task makes screen readers re-announce identical messages.
  const region = liveRegion;
  setTimeout(() => {
    region.textContent = message;
  }, 50);
}
