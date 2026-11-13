/** The `url()`s of a computed CSS value: quoted, with backslash escapes. */
const CSS_URL = /url\("((?:[^"\\]|\\.)*)"\)/g;
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Image elements loading what CSS values of a document name, by document and URL. */
const probes = new WeakMap<Document, Map<string, HTMLImageElement>>();

/**
 * Whether `doc` still loads an image that `value`, a computed CSS value, names. A CSS image fires no
 * event once it has loaded. An image element of the same document given the same URL shares the
 * document's fetch of it (Chromium and Firefox fetch an image once per document and URL), so it is
 * `complete` once the page's image has loaded or failed: by then the boxes laid out by it took its
 * size. Each such element stays for the document's life and answers at once from then on.
 */
export function cssImagePending(doc: Document, value: string): boolean {
  let known = probes.get(doc);
  for (const [, raw = ""] of value.matchAll(CSS_URL)) {
    const url = raw.includes("\\") ? raw.replace(/\\(.)/g, "$1") : raw;
    if (!url || url.startsWith("#")) continue;
    if (!known) {
      known = new Map();
      probes.set(doc, known);
    }
    let probe = known.get(url);
    if (!probe) {
      probe = doc.createElementNS(XHTML_NS, "img") as HTMLImageElement;
      probe.src = url;
      known.set(url, probe);
    }
    if (!probe.complete) return true;
  }
  return false;
}
