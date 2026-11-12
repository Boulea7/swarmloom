import { cssUrl, URL_TOKEN, urlOf } from "./css-url";
import { preload, stillImageSource } from "./still-image";

/*
 * Still copies of animated images painted by CSS. A url() in `background-image`, `mask-image`,
 * `border-image-source` or `list-style-image` plays an animated SVG, GIF, APNG, WebP or AVIF on the
 * browser's own clock, as an `<img>` does (see still-image.ts), out of reach of the world freeze and
 * an export's seek. Such a url() is swapped for the still copy image layers show.
 */

/** Longhands that paint url() images; a shorthand (`background`, `mask`, `list-style`) sets one of them. */
const IMAGE_PROPS = ["background-image", "mask-image", "-webkit-mask-image", "border-image-source", "list-style-image"];

/** Writes `copies` over the url()s `read` holds, into `el`'s inline style. */
function rewrite(
  el: HTMLElement | SVGElement,
  read: CSSStyleDeclaration,
  copies: ReadonlyMap<string, string>,
  important: boolean,
): void {
  const style = el.style;
  for (const name of IMAGE_PROPS) {
    const value = read.getPropertyValue(name);
    if (!value.includes("url(")) continue;
    const next = value.replace(URL_TOKEN, (all, dq?: string, sq?: string, bare?: string) => {
      const copy = copies.get(urlOf(dq, sq, bare));
      return copy === undefined ? all : cssUrl(copy);
    });
    if (next !== value) style.setProperty(name, next, important ? "important" : style.getPropertyPriority(name));
  }
}

/**
 * Swaps the animated url() images of `el`'s inline style for still copies; with `computed`, those of
 * its computed style, overridden inline with !important (a page whose stylesheets set them). A copy
 * that answers at once (an SVG `data:` URL) is applied now, the others once decoded or fetched.
 * Returns a promise that settles once every copy is in place and decoded (it never rejects), or null
 * when nothing is swapped. `doc` fetches and draws the copies, as in stillImageSource.
 */
export function holdCssImages(el: HTMLElement | SVGElement, doc: Document, computed = false): Promise<void> | null {
  const view = el.ownerDocument.defaultView;
  if (computed && !view) return null;
  const read = computed ? (view as Window).getComputedStyle(el) : el.style;
  const urls = new Set<string>();
  for (const name of IMAGE_PROPS) {
    const value = read.getPropertyValue(name);
    if (value.includes("url(")) for (const m of value.matchAll(URL_TOKEN)) urls.add(urlOf(m[1], m[2], m[3]));
  }
  if (urls.size === 0) return null;
  const now = new Map<string, string>();
  const copies = new Map<string, string>();
  const waits: Promise<void>[] = [];
  for (const url of urls) {
    const still = stillImageSource(url, doc);
    if (typeof still === "string") {
      if (still === url) continue;
      now.set(url, still);
      waits.push(preload(still, el.ownerDocument));
    } else {
      waits.push(
        still.then((copy) => {
          if (copy === url) return;
          copies.set(url, copy);
          return preload(copy, el.ownerDocument);
        }),
      );
    }
  }
  if (now.size > 0) rewrite(el, read, now, computed);
  if (waits.length === 0) return null;
  return Promise.all(waits).then(() => {
    if (copies.size > 0) rewrite(el, read, copies, computed);
  });
}

/** {@link holdCssImages} over several elements: one promise for all of them, or null when none waits. */
export function holdAllCssImages(
  els: Iterable<HTMLElement | SVGElement>,
  doc: Document,
  computed = false,
): Promise<void> | null {
  const waits: Promise<void>[] = [];
  for (const el of els) {
    const held = holdCssImages(el, doc, computed);
    if (held) waits.push(held);
  }
  return waits.length > 0 ? Promise.all(waits).then(() => undefined) : null;
}
