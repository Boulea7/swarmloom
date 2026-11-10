import { type HandoffReason, MSG_PAGE, type PagePayload, PROTOCOL_VERSION } from "./protocol";

/**
 * Serializes the live page for the Studio handoff.
 *
 * Works on a clone of the whole document. A cloned document has no browsing context, so cloning
 * runs no custom element constructors and starts no image or media fetches, and the page itself
 * is never touched. In the copy:
 *  - password fields get an empty `value` attribute (React mirrors typed values into it);
 *  - CSSOM rules are written back into their `<style>` elements, because CSS-in-JS libraries
 *    insert rules without text and `outerHTML` would lose them.
 *
 * The markup starts with `<!DOCTYPE html>` (when the page has a doctype, to keep the rendering
 * mode) and `<base href="{base}">`. The HTML parser moves that element to the start of `<head>`,
 * where it overrides any `<base>` of the page, so every relative URL (src, href, srcset, CSS
 * `url()`) resolves to the original absolute URL when the markup is rendered as a document.
 * Scripts and hidden inputs are left to the receiver, which must sanitize the markup anyway.
 *
 * This code ships inside the size-limited loader: keep it small and dependency-free.
 *
 * @param w Window of the page (scroll offsets, viewport size and pixel ratio are read from it).
 * @param d Document of the page.
 * @param reason Why the page is handed to the Studio.
 */
export function serializePage(w: Window, d: Document, reason: HandoffReason): PagePayload {
  const copy = d.cloneNode(true) as Document;
  const styles = copy.querySelectorAll("style");
  d.querySelectorAll("style").forEach((style, i) => {
    try {
      // `sheet` is null for styles the browser does not apply; the copy keeps their text.
      styles[i].textContent = [...(style.sheet as CSSStyleSheet).cssRules].map((r) => r.cssText).join("");
    } catch {}
  });
  // `defaultValue` reflects the value attribute.
  copy.querySelectorAll<HTMLInputElement>("[type=password]").forEach((el) => {
    el.defaultValue = "";
  });
  return {
    type: MSG_PAGE,
    v: PROTOCOL_VERSION,
    reason,
    url: d.URL,
    // A serialized URL never contains a raw quote; "&" is the only character to escape.
    html: `${d.doctype ? "<!DOCTYPE html>" : ""}<base href="${d.baseURI.replace(/&/g, "&amp;")}">${copy.documentElement.outerHTML}`,
    viewport: { x: w.scrollX, y: w.scrollY, w: w.innerWidth, h: w.innerHeight, dpr: w.devicePixelRatio },
  };
}
