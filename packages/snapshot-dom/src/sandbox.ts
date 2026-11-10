import type { Blueprint } from "@swarmloom/core";
import { waitForImages } from "./capture/scroller";
import { isDocument } from "./dom/env";
import type { PageBackground } from "./page/background";
import { sanitizeFragment } from "./page/sanitize";
import { capture, waitForFonts } from "./snapshot";
import type { SnapshotHtmlOptions, SnapshotOptions } from "./types";
import { throwIfAborted } from "./util/abort";

/** Fonts and images in the sandbox get this long to load. */
const LOAD_TIMEOUT_MS = 3000;
/** Upper bound for sandbox widths (CSS px). */
const MAX_WIDTH = 16384;

/** Marks the sandbox host so page scripts and other snapshots can ignore it. */
const SANDBOX_ATTR = "data-swarmloom-sandbox";

/**
 * Shadow-root base sheet: isolates the content from inherited page styles and keeps the root in
 * normal flow at the requested width. Caller CSS comes after it and may restyle `.sl-root`.
 */
function baseCss(width: number): string {
  return [
    `:host{all:initial!important;display:block!important;position:absolute!important;left:-100000px!important;top:0!important;width:${width}px!important;contain:layout style!important;pointer-events:none!important}`,
    ".sl-root{display:block;box-sizing:border-box;width:100%;margin:0;font:16px/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas;overflow-wrap:break-word}",
    ".sl-root img,.sl-root svg,.sl-root video{max-width:100%}",
  ].join("\n");
}

function validate(html: unknown, opts: SnapshotHtmlOptions | undefined): asserts opts is SnapshotHtmlOptions {
  if (typeof html !== "string") throw new TypeError("snapshotHtml: html must be a string");
  if (!opts || typeof opts !== "object") throw new TypeError("snapshotHtml: options with a width are required");
  const w = opts.width;
  if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || w > MAX_WIDTH) {
    throw new RangeError(`snapshotHtml: width must be a number in (0, ${MAX_WIDTH}], got ${String(w)}`);
  }
  for (const key of ["css", "baseUrl", "background", "icon"] as const) {
    const v = opts[key];
    if (v !== undefined && typeof v !== "string") throw new TypeError(`snapshotHtml: ${key} must be a string`);
  }
  if (opts.scheme !== undefined && opts.scheme !== "light" && opts.scheme !== "dark") {
    throw new TypeError(`snapshotHtml: scheme must be "light" or "dark"`);
  }
  if (opts.document !== undefined && !isDocument(opts.document)) {
    throw new TypeError("snapshotHtml: document must be a Document");
  }
  if (opts.baseUrl !== undefined) {
    try {
      new URL(opts.baseUrl);
    } catch {
      throw new TypeError(`snapshotHtml: baseUrl must be an absolute URL, got ${opts.baseUrl}`);
    }
  }
}

/** The plain snapshot options of an html snapshot; the sandbox always captures with origin "element". */
function snapshotOptionsOf(o: SnapshotHtmlOptions): SnapshotOptions {
  const out: SnapshotOptions = { origin: "element" };
  if (o.source !== undefined) out.source = o.source;
  if (o.maxLayers !== undefined) out.maxLayers = o.maxLayers;
  if (o.maxHeight !== undefined) out.maxHeight = o.maxHeight;
  if (o.detectDuplicates !== undefined) out.detectDuplicates = o.detectDuplicates;
  if (o.detectGuides !== undefined) out.detectGuides = o.detectGuides;
  if (o.screenshot !== undefined) out.screenshot = o.screenshot;
  if (o.inlineImages !== undefined) out.inlineImages = o.inlineImages;
  if (o.showFormValues !== undefined) out.showFormValues = o.showFormValues;
  if (o.signal !== undefined) out.signal = o.signal;
  return out;
}

/** Hidden off-screen host with an open shadow root holding the sanitised content at a fixed width. */
function mountSandbox(
  doc: Document,
  html: string,
  opts: SnapshotHtmlOptions,
): { host: HTMLElement; root: HTMLElement } {
  const host = doc.createElement("div");
  host.setAttribute(SANDBOX_ATTR, "");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  const shadow = host.attachShadow({ mode: "open" });
  const base = doc.createElement("style");
  base.textContent = baseCss(opts.width);
  shadow.append(base);
  if (opts.css) {
    const theme = doc.createElement("style");
    theme.textContent = opts.css;
    shadow.append(theme);
  }
  const root = doc.createElement("div");
  root.className = "sl-root";
  if (opts.scheme) root.style.colorScheme = opts.scheme;
  root.append(sanitizeFragment(doc, html, opts.baseUrl));
  shadow.append(root);
  (doc.body ?? doc.documentElement).append(host);
  return { host, root };
}

/**
 * Lays out an HTML fragment in an isolated hidden sandbox (open shadow root, off-screen, fixed
 * width), waits up to 3 s for fonts and images, snapshots it with origin "element" (so the content's
 * top-left is (0,0)) and removes the sandbox again, also on failure or abort.
 *
 * The fragment is sanitised first: scripts, event handlers, nested frames and script-capable URLs
 * are removed. `opts.css` is applied inside the shadow root and copied into `Blueprint.css`.
 */
export async function snapshotHtml(html: string, opts: SnapshotHtmlOptions): Promise<Blueprint> {
  validate(html, opts);
  throwIfAborted(opts.signal);
  const doc = opts.document ?? globalThis.document;
  if (!doc) throw new TypeError("snapshotHtml: no document available; pass opts.document");
  const { host, root } = mountSandbox(doc, html, opts);
  try {
    const shadow = host.shadowRoot as ShadowRoot;
    await Promise.all([
      waitForFonts(doc, LOAD_TIMEOUT_MS, opts.signal),
      waitForImages(shadow, LOAD_TIMEOUT_MS, opts.signal),
    ]);
    let background: PageBackground | undefined;
    if (opts.background !== undefined) {
      background = { css: opts.background, scheme: opts.scheme ?? "light", sources: [root] };
    }
    return await capture(root, snapshotOptionsOf(opts), {
      background,
      css: opts.css,
      icon: opts.icon,
      scheme: opts.scheme,
      defaultSource: { type: "html" },
    });
  } finally {
    host.remove();
  }
}
