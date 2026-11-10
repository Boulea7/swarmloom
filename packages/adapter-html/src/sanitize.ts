import createDOMPurify, { type Config, type WindowLike } from "dompurify";

/** Elements that never belong in a captured page: frames, plugins and document-level controls. */
const FORBID_TAGS = ["iframe", "frame", "frameset", "object", "embed", "base", "meta", "portal", "foreignObject"];

/**
 * Shared policy: everything that renders is kept (inline styles, `<style>`, SVG, form controls as
 * visuals, `<link rel=stylesheet>`); scripts, event handlers, script URLs, frames, plugins and
 * SVG `foreignObject` are removed.
 */
const BASE_CONFIG: Config = {
  ADD_TAGS: ["link"],
  ADD_ATTR: ["target"],
  FORBID_TAGS,
  ALLOW_DATA_ATTR: true,
  RETURN_TRUSTED_TYPE: false,
};

/**
 * Fragments are laid out inside a shadow root, where element ids do not become document
 * properties, so ids such as "title" are kept (SANITIZE_DOM off).
 */
const FRAGMENT_CONFIG: Config = { ...BASE_CONFIG, FORCE_BODY: true, SANITIZE_DOM: false };

/**
 * Whole documents get their own frame document, where `<img name="body">` would shadow
 * `document.body` for the snapshotter, so DOM clobbering protection stays on.
 */
const DOCUMENT_CONFIG: Config = { ...BASE_CONFIG, WHOLE_DOCUMENT: true };

const PROBE_IN = '<p title="t">a</p><img src="x.png" onerror="e()"><script>s()</script>';
const PROBE_OUT = '<p title="t">a</p><img src="x.png">';

const instances = new WeakMap<object, ReturnType<typeof createDOMPurify>>();

function purifier(win: Window): ReturnType<typeof createDOMPurify> {
  let p = instances.get(win);
  if (p) return p;
  p = createDOMPurify(win as unknown as WindowLike);
  // Fail closed: some DOM emulations (e.g. happy-dom) run DOMPurify without errors but let
  // scripts through. A known input must come out exactly clean before anything is trusted.
  if (!p.isSupported || p.sanitize(PROBE_IN, { RETURN_TRUSTED_TYPE: false }) !== PROBE_OUT) {
    throw new Error("html: this DOM environment cannot sanitize HTML reliably; run in a browser");
  }
  p.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "link") return;
    const el = node as Element;
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    // Disarm rather than remove: removing nodes from a hook disturbs DOMPurify's tree walk.
    if (!rel.includes("stylesheet") || rel.includes("import")) el.removeAttribute("href");
  });
  instances.set(win, p);
  return p;
}

/**
 * Sanitizes an HTML fragment before it is laid out in the host document (where, unlike in a
 * sandbox frame, an `<img onerror>` would run).
 */
export function sanitizeFragment(html: string, win: Window): string {
  return purifier(win).sanitize(html, FRAGMENT_CONFIG) as string;
}

/** Sanitizes a whole document; returns `<html>...</html>` markup without a doctype. */
export function sanitizeDocument(html: string, win: Window): string {
  return purifier(win).sanitize(html, DOCUMENT_CONFIG) as string;
}
