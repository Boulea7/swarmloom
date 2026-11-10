/**
 * Inline head script, bundled to a tiny IIFE by the Vite plugin. Runs before first paint:
 * marks the document as scripted and records the detected browser so CSS can pick the
 * matching install label and highlight the matching install row with no layout shift.
 */

import { detectBrowser } from "./detect";

interface UaData {
  brands?: { brand?: unknown }[];
  mobile?: unknown;
}

const root = document.documentElement;
root.classList.add("js");
try {
  const nav = navigator as Navigator & { userAgentData?: UaData; brave?: unknown };
  const data = nav.userAgentData;
  const brands = Array.isArray(data?.brands)
    ? data.brands.map((b) => b.brand).filter((b): b is string => typeof b === "string")
    : undefined;
  const found = detectBrowser({
    ua: nav.userAgent,
    brands,
    mobile: typeof data?.mobile === "boolean" ? data.mobile : undefined,
    brave: typeof nav.brave === "object" && nav.brave !== null,
    maxTouchPoints: nav.maxTouchPoints,
  });
  root.dataset.browser = found.browser;
  root.dataset.channel = found.channel ?? "";
} catch {
  // Detection is cosmetic; the generic label and an unhighlighted list are already in the markup.
}
