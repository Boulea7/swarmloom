/**
 * Guesses which mobile browser shows the install page, so the matching step-by-step guide opens
 * first. Only a convenience: every guide stays reachable, and a wrong or missing guess changes
 * nothing else.
 */

/** Mobile browsers with their own guide; the value is the guide's `<details>` id suffix. */
export type MobileBrowser = "chrome" | "ios" | "firefox" | "samsung";

/**
 * @param ua `navigator.userAgent`.
 * @param maxTouchPoints `navigator.maxTouchPoints` (iPadOS reports a desktop Mac user agent).
 * @returns The guide to open, or null for desktop and browsers without a guide.
 */
export function detectMobileBrowser(ua: string, maxTouchPoints: number): MobileBrowser | null {
  if (/SamsungBrowser\//.test(ua)) return "samsung";
  const android = /Android/.test(ua);
  if (android && /Firefox\//.test(ua)) return "firefox";
  // Only Safari: Chrome, Firefox and Edge on iOS (CriOS/FxiOS/EdgiOS) have other bookmark menus.
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (apple) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? null : "ios";
  if (android && /Chrome\//.test(ua) && !/EdgA|OPR|YaBrowser|UCBrowser|Vivaldi/.test(ua)) return "chrome";
  return null;
}
