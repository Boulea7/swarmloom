import { isDangerousUrl } from "../util/html";

/** Elements removed with their content: active content, document metadata and nested browsing contexts. */
const DROP_TAGS: ReadonlySet<string> = new Set([
  "script",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "meta",
  "link",
  "title",
  "portal",
  "foreignobject",
]);

/** Attributes holding URLs that are resolved against the base URL and checked for dangerous schemes. */
const URL_ATTRS: ReadonlySet<string> = new Set([
  "href",
  "src",
  "poster",
  "xlink:href",
  "action",
  "formaction",
  "data",
  "background",
  "cite",
]);

/** Attributes dropped outright: they run script, steal focus or load nested documents. */
const DROP_ATTRS: ReadonlySet<string> = new Set(["srcdoc", "autofocus", "ping", "http-equiv", "nonce", "is"]);

function resolveUrl(value: string, base: string | undefined): string | null {
  if (isDangerousUrl(value)) return null;
  if (!base) return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("#") || /^data:/i.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed, base);
    return isDangerousUrl(u.href) ? null : u.href;
  } catch {
    return null;
  }
}

function resolveSrcset(value: string, base: string | undefined): string | null {
  const parts: string[] = [];
  for (const candidate of value.split(",")) {
    const [url, ...desc] = candidate.trim().split(/\s+/);
    if (!url) continue;
    const resolved = resolveUrl(url, base);
    if (resolved) parts.push([resolved, ...desc].join(" "));
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function cleanElement(el: Element, base: string | undefined): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on") || DROP_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.has(name)) {
      const v = resolveUrl(attr.value, base);
      if (v === null) el.removeAttribute(attr.name);
      else if (v !== attr.value) el.setAttribute(attr.name, v);
    } else if (name === "srcset" || name === "imagesrcset") {
      const v = resolveSrcset(attr.value, base);
      if (v === null) el.removeAttribute(attr.name);
      else el.setAttribute(attr.name, v);
    } else if (name === "style" && /expression\s*\(|javascript:/i.test(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
  // The sandbox is off-screen: lazy loading would never start.
  if (el.getAttribute("loading") === "lazy") el.setAttribute("loading", "eager");
  if (el.localName === "a") el.setAttribute("tabindex", "-1");
}

/**
 * Parses an HTML fragment into an inert fragment owned by `doc` and removes active content:
 * scripts, nested browsing contexts, document metadata, event handler attributes and
 * script-capable URLs. Relative URLs are resolved against `base` when given.
 * Style elements are kept (they are scoped by the sandbox's shadow root).
 */
export function sanitizeFragment(doc: Document, html: string, base?: string): DocumentFragment {
  const template = doc.createElement("template");
  template.innerHTML = html;
  const frag = template.content;
  const drop: Element[] = [];
  const walker = doc.createTreeWalker(frag, 1 /* NodeFilter.SHOW_ELEMENT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n as Element;
    if (DROP_TAGS.has(el.localName.toLowerCase())) drop.push(el);
    else cleanElement(el, base);
  }
  for (const el of drop) el.remove();
  return doc.importNode(frag, true);
}
