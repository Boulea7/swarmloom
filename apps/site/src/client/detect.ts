/**
 * Browser detection for the install call to action. Pure and dependency free so it can run in the
 * inline head script (before first paint, so the right label renders without layout shift) and in
 * unit tests.
 */

import type { ChannelId, CtaKey } from "../content/types";

export interface DetectInput {
  /** `navigator.userAgent`. */
  ua: string;
  /** `navigator.userAgentData.brands[].brand`, when the browser exposes UA client hints. */
  brands?: readonly string[];
  /** `navigator.userAgentData.mobile`. */
  mobile?: boolean;
  /** True when `navigator.brave` exists (Brave hides itself from the UA string). */
  brave?: boolean;
  /** `navigator.maxTouchPoints`; iPadOS reports a desktop UA but has touch points. */
  maxTouchPoints?: number;
}

export interface Detected {
  /** Which hero label variant to show. */
  browser: CtaKey;
  /** Which install row to highlight; null when no row fits the browser. */
  channel: ChannelId | null;
}

const CHROMIUM_CHANNEL: readonly CtaKey[] = ["chrome", "edge", "brave", "opera"];

function result(browser: CtaKey, chromium = false): Detected {
  if (CHROMIUM_CHANNEL.includes(browser) || (browser === "generic" && chromium)) {
    return { browser, channel: "chromium" };
  }
  if (browser === "firefox" || browser === "safari" || browser === "studio") return { browser, channel: browser };
  return { browser, channel: null };
}

/** Classifies the current browser. Unknown input falls back to the generic label. */
export function detectBrowser(input: DetectInput): Detected {
  const ua = typeof input.ua === "string" ? input.ua : "";
  const brands = Array.isArray(input.brands) ? input.brands.filter((b) => typeof b === "string") : [];
  const has = (name: string): boolean => brands.includes(name);
  const touch = typeof input.maxTouchPoints === "number" ? input.maxTouchPoints : 0;

  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  if (ios) {
    // Every iOS browser is WebKit, but only Safari itself runs Safari Web Extensions.
    return result(/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? "studio" : "safari");
  }
  const android = /Android/.test(ua);
  if (android) return result(/Firefox\//.test(ua) ? "firefox" : "studio");
  if (input.mobile === true) return result("studio");

  if (/Firefox\//.test(ua) && !/Seamonkey\//.test(ua)) return result("firefox");
  if (input.brave === true || has("Brave")) return result("brave");
  if (has("Microsoft Edge") || /Edg\//.test(ua)) return result("edge");
  if (has("Opera") || has("Opera GX") || /OPR\//.test(ua)) return result("opera");
  const chromiumUa = /Chrome\/|Chromium\//.test(ua);
  if (has("Google Chrome")) return result("chrome");
  if (brands.length > 0) return result("generic", has("Chromium") || chromiumUa);
  // Without client hints, other Chromium browsers (Vivaldi, Yandex, Samsung) add their own token.
  if (chromiumUa) {
    return /Vivaldi|YaBrowser|SamsungBrowser|Electron|HeadlessChrome/.test(ua)
      ? result("generic", true)
      : result("chrome");
  }
  if (/Safari\//.test(ua) && /Version\//.test(ua) && /Macintosh/.test(ua)) return result("safari");
  return result("generic");
}
