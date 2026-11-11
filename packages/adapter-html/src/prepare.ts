import { applyNetworkPolicy, type NetworkPolicy, sourceList } from "./policy";
import { sanitizeDocument } from "./sanitize";

/** Options of {@link prepareDocument}. */
export interface PrepareOptions {
  /** Absolute base URL for relative links and assets (http, https or file). */
  baseUrl?: string;
  /** Remote subresources the frame may load. Default "https" (images and fonts only). */
  network?: NetworkPolicy;
  /** Reject documents with more elements than this after sanitizing. Default 60 000. */
  maxElements?: number;
}

/** A document ready for the capture frame, plus what preparation found. */
export interface PreparedDocument {
  /** Serialized document: doctype, our CSP, base and referrer policy first in `<head>`. */
  html: string;
  /** Base URL in effect (the caller's, adjusted by the document's own `<base href>`). */
  baseUrl?: string;
  /** The source had scripts or inline event handlers; they were removed and never run. */
  hadScripts: boolean;
  /** `<title>` of the document, trimmed. */
  title?: string;
  /** Subresource references removed by the network policy. */
  refused: number;
}

const DEFAULT_MAX_ELEMENTS = 60_000;

/** Elements that never render content and could navigate or reconfigure the frame. */
const DROP_ALWAYS = ["base", "meta[http-equiv]", "meta[name=referrer]", "portal"];
/** Elements whose `name`/`id` become properties of their document (named property access). */
const NAMED_ELEMENTS = "img[name],img[id],form[name],form[id],embed[name],embed[id],object[name],object[id]";

/**
 * Content Security Policy of the capture frame. Scripts, connections, forms, frames, workers and
 * plugins are always off. Images and fonts may come from data:, blob:, the local origin of a plain
 * http `baseUrl` (see `localOrigin`) and, with the default "https" policy, any https: URL; style
 * sheets and media only from data: and blob:.
 */
export function contentSecurityPolicy(opts: Pick<PrepareOptions, "network" | "baseUrl"> = {}): string {
  const remote = sourceList(opts.network ?? "https", opts.baseUrl);
  return [
    "default-src 'none'",
    `img-src ${remote}`,
    `font-src ${remote}`,
    "style-src 'unsafe-inline' data: blob:",
    "media-src data: blob:",
    "script-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

function serializeDoctype(doc: Document): string {
  const dt = doc.doctype;
  if (!dt) return "";
  const pub = dt.publicId ? ` PUBLIC "${dt.publicId}"` : "";
  const sys = dt.systemId ? `${dt.publicId ? "" : " SYSTEM"} "${dt.systemId}"` : "";
  return `<!DOCTYPE ${dt.name || "html"}${pub}${sys}>`;
}

function isAbsoluteBase(url: string | undefined): url is string {
  return !!url && /^(?:https?|file):/i.test(url);
}

function resolveBase(doc: Document, baseUrl: string | undefined): string | undefined {
  const own = doc.querySelector("base[href]")?.getAttribute("href")?.trim() || undefined;
  if (!baseUrl) return isAbsoluteBase(own) ? own : undefined;
  if (!own) return baseUrl;
  try {
    const resolved = new URL(own, baseUrl).href;
    return isAbsoluteBase(resolved) ? resolved : baseUrl;
  } catch {
    return baseUrl;
  }
}

function parse(html: string, win: Window): Document {
  const Parser = (win as Window & { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) throw new Error("html: DOMParser is not available in this environment");
  return new Parser().parseFromString(html, "text/html");
}

/**
 * Removes `name`/`id` values that would shadow document properties (`<img name="body">` turns
 * `document.body` into the image for the snapshotter). Ordinary element ids stay, so the page's
 * `#id` selectors keep working.
 */
function removeClobbering(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll(NAMED_ELEMENTS))) {
    for (const attr of ["name", "id"]) {
      const value = el.getAttribute(attr);
      if (value && value in doc) el.removeAttribute(attr);
    }
  }
}

/** True when the parsed source has scripts, inline event handlers or script URLs (they never run). */
function hasScripts(doc: Document): boolean {
  if (doc.querySelector("script")) return true;
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on") || /^\s*javascript:/i.test(attr.value)) return true;
    }
  }
  return false;
}

function meta(doc: Document, attrs: Record<string, string>): HTMLMetaElement {
  const el = doc.createElement("meta");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Rewrites a full HTML document for capture in the sandbox frame. The document goes through
 * DOMPurify (scripts, event handlers, script URLs, frames, plugins and `foreignObject` removed),
 * then `<base>` and `http-equiv` metas are dropped and our own charset, CSP, referrer policy,
 * base URL and a scrollbar-hiding rule are put first in `<head>`. Parsing uses DOMParser, so
 * nothing in the input runs here.
 *
 * @throws RangeError when the sanitized document has more than `maxElements` elements.
 */
export function prepareDocument(html: string, win: Window, opts: PrepareOptions = {}): PreparedDocument {
  // The original doctype decides standards vs quirks layout; DOMPurify does not keep it.
  const original = parse(html, win);
  const doctype = serializeDoctype(original);
  const base = resolveBase(original, opts.baseUrl);
  const doc = parse(sanitizeDocument(html, win), win);

  const maxElements = opts.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const count = doc.getElementsByTagName("*").length;
  if (count > maxElements) {
    throw new RangeError(`html: the document has ${count} elements, over the ${maxElements} limit`);
  }

  for (const el of Array.from(doc.querySelectorAll(DROP_ALWAYS.join(",")))) el.remove();
  removeClobbering(doc);
  // The CSP below enforces the same rules; rewriting first avoids blocked requests and srcset
  // choices that depend on the device pixel ratio.
  const refused = applyNetworkPolicy(doc, opts.network ?? "https", base);

  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement("head"), doc.body);
  for (const old of Array.from(head.querySelectorAll("meta[charset]"))) old.remove();
  const nodes: Node[] = [
    meta(doc, { charset: "utf-8" }),
    meta(doc, {
      "http-equiv": "Content-Security-Policy",
      content: contentSecurityPolicy({ network: opts.network, baseUrl: base }),
    }),
    meta(doc, { name: "referrer", content: "no-referrer" }),
  ];
  if (base) {
    const baseEl = doc.createElement("base");
    baseEl.setAttribute("href", base);
    nodes.push(baseEl);
  }
  const chrome = doc.createElement("style");
  chrome.textContent = "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}";
  nodes.push(chrome);
  head.prepend(...nodes);

  const title = original.title.trim() || undefined;
  return {
    html: `${doctype}${doc.documentElement.outerHTML}`,
    ...(base ? { baseUrl: base } : {}),
    hadScripts: hasScripts(original),
    refused,
    ...(title ? { title } : {}),
  };
}
