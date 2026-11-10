import { safeImageUrl } from "../util/html";

/** Attributes used by common lazy-loading libraries to hold the real image URL. */
const LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-url"] as const;
const PLACEHOLDER = /^data:image\/(?:gif|png|svg\+xml)[^,]*,.{0,200}$/i;

/** Best URL for an `<img>`: the chosen srcset candidate, `src`, or a lazy-loading attribute. */
export function imageUrlOf(img: Element, base: string): string | null {
  const el = img as HTMLImageElement;
  const current = typeof el.currentSrc === "string" ? el.currentSrc : "";
  const src = current || el.getAttribute("src") || "";
  const loaded = el.complete === true && (el.naturalWidth ?? 0) > 0;
  // Tiny placeholder data URLs are swapped for the real image by lazy loaders.
  if (!src || (!loaded && !current) || PLACEHOLDER.test(src)) {
    for (const name of LAZY_ATTRS) {
      const value = el.getAttribute(name);
      if (value) {
        const safe = safeImageUrl(value, base);
        if (safe) return safe;
      }
    }
  }
  return src ? safeImageUrl(src, base) : null;
}
