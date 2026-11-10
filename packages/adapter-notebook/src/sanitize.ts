/**
 * HTML sanitizing for markdown cells and text/html outputs (DOMPurify), plus the notebook image
 * policy: only embedded PNG, JPEG and GIF data URLs load (sized from their headers so layout does
 * not wait for decoding); remote images become labelled placeholders, so opening a notebook never
 * contacts third-party hosts.
 */

import DOMPurify, { type Config, type DOMPurify as Purifier, type WindowLike } from "dompurify";
import { dataUrlImage, imageSize } from "./images";
import type { ImageData } from "./nbformat";

const ALLOWED_URI = /^(?:(?:https?|mailto):|#|data:image\/(?:png|jpe?g|gif);base64,)/i;

const FORBID_TAGS = [
  "style",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "iframe",
  "frame",
  "object",
  "embed",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "dialog",
  "template",
  "svg",
  "math",
];
const FORBID_ATTR = ["target", "srcset", "action", "formaction", "ping", "background", "poster", "id", "name"];

const CONFIG: Config = {
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
};

/** Declarations that could move content out of its layer, animate it, or load resources. */
const BLOCKED_PROP =
  /^(?:position|top|left|right|bottom|inset(?:-.*)?|z-index|float|transform|translate|rotate|scale|filter|backdrop-filter|transition(?:-.*)?|animation(?:-.*)?|content|cursor|pointer-events|behavior|-moz-binding|mask(?:-.*)?|clip-path)$/;
const BLOCKED_VALUE = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|@import|\\/i;

/** Keeps the harmless declarations of an inline style attribute. */
export function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!/^-?[a-z][a-z-]*$/.test(name) || !value || BLOCKED_PROP.test(name) || BLOCKED_VALUE.test(value)) continue;
    out.push(`${name}:${value}`);
  }
  return out.join(";");
}

const purifiers = new WeakMap<object, Purifier | null>();

/** The DOMPurify instance of a window, or null where DOMPurify cannot run. */
function purifierFor(win: Window): Purifier | null {
  if (purifiers.has(win)) return purifiers.get(win) ?? null;
  const p = DOMPurify(win as unknown as WindowLike);
  if (p.isSupported) {
    p.addHook("uponSanitizeAttribute", (_node, data) => {
      if (data.attrName === "style") data.attrValue = cleanStyle(data.attrValue);
    });
  }
  purifiers.set(win, p.isSupported ? p : null);
  return p.isSupported ? p : null;
}

const XHTML = "http://www.w3.org/1999/xhtml";

/** Elements kept by the allowlist pass; unknown elements are unwrapped (their text stays). */
const ALLOWED_TAGS = new Set(
  (
    "a abbr article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del details dfn div dl dt " +
    "em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s " +
    "samp section small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr"
  ).split(" "),
);
/** Elements removed together with their content. */
const DROP_TAGS = new Set([
  ...FORBID_TAGS,
  "script",
  "noscript",
  "title",
  "head",
  "frameset",
  "applet",
  "portal",
  "slot",
  "xmp",
  "plaintext",
  "noembed",
  "noframes",
]);
const ALLOWED_ATTRS = new Set(
  (
    "class title alt src href width height colspan rowspan align valign start reversed type scope headers lang dir " +
    "style border cellpadding cellspacing open datetime color face size role"
  ).split(" "),
);

/**
 * Allowlist pass over DOMPurify's result. DOMPurify is the main sanitizer in browsers; this pass
 * guarantees the same invariants where it is missing or cannot walk the DOM (some DOM shims).
 */
function enforce(node: ParentNode, depth: number): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1 || depth > 200) {
      child.parentNode?.removeChild(child);
      continue;
    }
    const el = child as Element;
    const name = el.localName.toLowerCase();
    if (DROP_TAGS.has(name) || (el.namespaceURI !== null && el.namespaceURI !== XHTML)) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const a = attr.name.toLowerCase();
      const keep =
        (ALLOWED_ATTRS.has(a) || a.startsWith("aria-")) &&
        (a !== "href" || (name === "a" && ALLOWED_URI.test(attr.value.trim()))) &&
        (a !== "src" || (name === "img" && ALLOWED_URI.test(attr.value.trim())));
      if (!keep) el.removeAttribute(attr.name);
      else if (a === "style") el.setAttribute("style", cleanStyle(attr.value));
    }
    if (name === "a" && el.hasAttribute("href")) el.setAttribute("rel", "noopener noreferrer");
    enforce(el, depth + 1);
    if (!ALLOWED_TAGS.has(name)) el.replaceWith(...Array.from(el.childNodes));
  }
}

/** Applies the image policy to every <img> below `root`. */
function fixImages(root: ParentNode, doc: Document): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    const embedded = dataUrlImage(src);
    const size = embedded ? imageSize(embedded.mime, embedded.data) : null;
    if (!embedded || !size) {
      const span = doc.createElement("span");
      span.className = "slnb-noimg";
      const alt = (img.getAttribute("alt") ?? "").trim();
      span.textContent = alt ? `[image: ${alt}]` : "[image]";
      img.replaceWith(span);
      continue;
    }
    const w = Number(img.getAttribute("width"));
    const h = Number(img.getAttribute("height"));
    if (w > 0 && !(h > 0)) img.setAttribute("height", String(Math.round((w * size.h) / size.w)));
    else if (!(w > 0)) {
      img.setAttribute("width", String(size.w));
      img.setAttribute("height", String(h > 0 ? h : size.h));
    }
  }
}

/**
 * Sanitizes untrusted HTML in `doc`: no scripts, event handlers, forms, frames, style sheets,
 * SVG/MathML or remote images; inline styles keep only harmless declarations. DOMPurify runs
 * first where it is supported, then an allowlist pass enforces the same rules.
 */
export function sanitizeHtml(html: string, doc: Document): string {
  const win = doc.defaultView;
  const purifier = win ? purifierFor(win) : null;
  let frag: DocumentFragment;
  if (purifier) frag = purifier.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
  else {
    // <template> parsing is inert: no scripts run and no resources load.
    const tpl = doc.createElement("template");
    tpl.innerHTML = html;
    frag = tpl.content;
  }
  enforce(frag, 0);
  const owner = frag.ownerDocument ?? doc;
  fixImages(frag, owner);
  const box = owner.createElement("div");
  box.append(frag);
  return box.innerHTML;
}

/** Plain text of sanitized HTML (what the typing choreography types). */
export function htmlText(html: string, doc: Document): string {
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  return (tpl.content.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Replaces `attachment:<name>` references (markdown images and raw <img>) with data URLs. */
export function resolveAttachments(source: string, attachments: Record<string, ImageData>): string {
  if (!source.includes("attachment:")) return source;
  return source.replace(/attachment:([^\s"')>]+)/g, (whole, raw: string) => {
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // Keep the raw name.
    }
    const a = attachments[name];
    return a ? `data:${a.mime};base64,${a.data}` : whole;
  });
}
