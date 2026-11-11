import type { CSSMap } from "../types";

/**
 * Defence in depth for blueprint content. Adapters already sanitize, but blueprints can also be
 * loaded from files or URLs, so the stage never trusts markup, URLs or CSS property names.
 */

/** Elements removed with their subtree: scripting, embedding, document-level and animation elements. */
const DROP = new Set([
  "script",
  "noscript",
  "style",
  "link",
  "meta",
  "base",
  "title",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "template",
  "slot",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href", "poster", "background", "cite", "srcset", "data"]);
const DROP_ATTRS = new Set(["srcdoc", "formaction", "action", "http-equiv", "ping", "autofocus", "nonce", "is"]);

/**
 * True for URLs that are safe to load as passive content: http(s), blob:, data:image (non-SVG
 * is not required: SVG images cannot run script), fragment and relative URLs.
 */
export function isSafeUrl(url: string): boolean {
  const u = url
    .trim()
    .replace(/[\p{Cc}\s]+/gu, "")
    .toLowerCase();
  if (u === "" || u.startsWith("#") || u.startsWith("/") || u.startsWith(".")) return true;
  const colon = u.indexOf(":");
  if (colon < 0) return true;
  const slash = u.indexOf("/");
  if (slash >= 0 && slash < colon) return true; // relative path containing a colon later on
  const scheme = u.slice(0, colon);
  if (scheme === "http" || scheme === "https" || scheme === "blob") return true;
  if (scheme === "data") return u.startsWith("data:image/") || u.startsWith("data:font/");
  return false;
}

function cleanElement(el: Element): void {
  const attrs = el.attributes;
  for (let i = attrs.length - 1; i >= 0; i--) {
    const a = attrs[i];
    if (!a) continue;
    const name = a.name.toLowerCase();
    if (name.startsWith("on") || DROP_ATTRS.has(name)) {
      el.removeAttribute(a.name);
    } else if (URL_ATTRS.has(name)) {
      if (name === "srcset") {
        if (!a.value.split(",").every((part) => isSafeUrl(part.trim().split(/\s+/)[0] ?? "")))
          el.removeAttribute(a.name);
      } else if (!isSafeUrl(a.value)) {
        el.removeAttribute(a.name);
      }
    } else if (name === "style" && /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(a.value)) {
      el.removeAttribute(a.name);
    }
  }
  if (el.localName === "a") {
    el.setAttribute("rel", "noopener noreferrer");
    el.setAttribute("tabindex", "-1");
  }
  if (el.localName === "img") el.setAttribute("draggable", "false");
}

/**
 * Parses `html` inertly (template element: no script execution, no resource loads) and strips
 * active content. Returns the cleaned markup, which is safe to assign with innerHTML.
 */
export function sanitizeHtml(doc: Document, html: string): string {
  const tpl = doc.createElement("template");
  tpl.content.append(sanitizeFragment(doc, html));
  return tpl.innerHTML;
}

/**
 * Like {@link sanitizeHtml} but returns the cleaned, still inert fragment. Insert copies made with
 * `doc.importNode(fragment, true)`: cloning is cheaper than re-parsing on every (re-)mount, and
 * style attributes copied by cloning are not subject to a page CSP that blocks inline style
 * attributes in parsed markup (Chromium).
 */
export function sanitizeFragment(doc: Document, html: string): DocumentFragment {
  const tpl = doc.createElement("template");
  if (typeof html !== "string" || html.length === 0) return tpl.content;
  tpl.innerHTML = html;
  const remove: Element[] = [];
  const walker = doc.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.COMMENT_NODE) {
      comments.push(n);
      continue;
    }
    const el = n as Element;
    if (DROP.has(el.localName.toLowerCase())) remove.push(el);
    else cleanElement(el);
  }
  for (const el of remove) el.remove();
  for (const c of comments) c.parentNode?.removeChild(c);
  return tpl.content;
}

const PROP = /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/;
/** Declarations that would move the layer out of its box or break export determinism. */
const STRUCTURAL = new Set([
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-inline",
  "width",
  "height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "z-index",
  "float",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-delay",
  "transition-timing-function",
  "animation",
  "animation-name",
  "animation-duration",
  "animation-delay",
  "animation-iteration-count",
  "animation-play-state",
  "content-visibility",
]);

function safeValue(v: unknown): v is string {
  return typeof v === "string" && v.length < 8192 && !/expression\s*\(|javascript:|-moz-binding|behavior\s*:/i.test(v);
}

/** True when `name: value` is a well-formed, non-active declaration. */
export function isSafeDeclaration(name: string, value: unknown): value is string {
  return typeof name === "string" && PROP.test(name) && safeValue(value);
}

/**
 * Applies a layer's final CSS to `el`, skipping structural properties owned by the stage
 * (position and size come from layer.box, motion from the choreography) and unsafe values.
 * A trailing "!important" in a value is honoured.
 */
export function applyLayerStyle(el: HTMLElement | SVGElement, css: CSSMap | undefined): void {
  if (!css || typeof css !== "object") return;
  const style = el.style;
  for (const name of Object.keys(css)) {
    const raw = css[name];
    if (STRUCTURAL.has(name) || !isSafeDeclaration(name, raw)) continue;
    setDecl(style, name, raw);
  }
}

/** Sets one declaration, honouring a trailing "!important". */
export function setDecl(style: CSSStyleDeclaration, name: string, raw: string): void {
  const m = /\s*!important\s*$/i.exec(raw);
  if (m) style.setProperty(name, raw.slice(0, m.index), "important");
  else style.setProperty(name, raw);
}

/** Accepts a CSS transform string from a blueprint (no url()/expressions, bounded length). */
export function safeTransform(t: unknown): string | null {
  if (typeof t !== "string" || t.length === 0 || t.length > 512) return null;
  return /^[\w\s().,%+\-*/#]+$/.test(t) ? t : null;
}
