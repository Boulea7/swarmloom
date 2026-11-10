import type { Blueprint, BlueprintSource, Layer } from "@swarmloom/core";
import { elementScrolls, findMainScroller, prescroll, shellOf } from "./capture/scroller";
import { createCapture } from "./capture/state";
import { rootContext, visit } from "./capture/walker";
import { isDocument, isElement, viewOf } from "./dom/env";
import { type ResolvedOptions, resolveOptions } from "./options";
import { documentBackground, elementBackground, type PageBackground } from "./page/background";
import { fontFaceCss } from "./page/fonts";
import { pageIcon } from "./page/icon";
import { inlineImages } from "./page/inline-images";
import { applyScreenshot } from "./page/screenshot";
import { detectDuplicates } from "./post/duplicates";
import { applyGuides, detectGuides } from "./post/guides";
import { paintOrder, truncate } from "./post/order";
import type { SnapshotOptions } from "./types";
import { delay, throwIfAborted } from "./util/abort";
import { round2 } from "./util/geom";

/** Live pages wait at most this long for web fonts before capture. */
const FONT_WAIT_MS = 1500;

/** Internal hooks used by snapshotHtml to override page-level results. */
export interface CaptureOverrides {
  background?: PageBackground;
  css?: string;
  icon?: string;
  scheme?: "light" | "dark";
  defaultSource?: BlueprintSource;
}

function defaultSource(doc: Document): BlueprintSource {
  const source: BlueprintSource = { type: "dom" };
  const title = doc.title?.trim();
  if (title) source.title = title;
  try {
    const u = new URL(doc.URL);
    if (u.protocol === "http:" || u.protocol === "https:") source.url = u.href;
  } catch {
    // Documents without a parseable URL (about:blank, srcdoc) carry no URL.
  }
  return source;
}

/** Waits for web fonts used by the page, bounded by a timeout. */
export async function waitForFonts(doc: Document, timeout: number, signal?: AbortSignal): Promise<void> {
  const fonts = doc.fonts;
  if (!fonts || fonts.status === "loaded") return;
  await Promise.race([fonts.ready.then(() => undefined), delay(timeout, signal).catch(() => undefined)]);
  throwIfAborted(signal);
}

function truncationReason(
  o: ResolvedOptions,
  layersDropped: number,
  heightDropped: number,
  elementCap: boolean,
): Blueprint["truncated"] {
  const reasons: string[] = [];
  if (layersDropped > 0) reasons.push(`layer limit of ${o.maxLayers} reached`);
  if (heightDropped > 0) reasons.push(`content below ${o.maxHeight} px omitted`);
  if (elementCap) reasons.push("element scan limit reached");
  if (reasons.length === 0) return undefined;
  return { reason: reasons.join("; "), dropped: layersDropped + heightDropped };
}

/** Core capture shared by snapshot() and snapshotHtml(). */
export async function capture(
  root: Element | Document,
  opts: SnapshotOptions | undefined,
  overrides: CaptureOverrides = {},
): Promise<Blueprint> {
  const o = resolveOptions(opts);
  if (!isDocument(root) && !(typeof root === "object" && root !== null && isElement(root as Node))) {
    throw new TypeError("snapshot: root must be an Element or a Document");
  }
  throwIfAborted(o.signal);
  const doc = isDocument(root) ? root : root.ownerDocument;
  const el = isDocument(root) ? root.documentElement : root;
  if (!el) throw new TypeError("snapshot: the document has no root element");
  if (!el.isConnected) throw new TypeError("snapshot: root must be connected to a document");
  const view = viewOf(doc);
  const pageRoot = el === doc.documentElement || el === doc.body;
  const mode = o.origin ?? (pageRoot ? "document" : "element");

  if (o.prescroll && mode === "document") await prescroll(doc, o.signal);
  await waitForFonts(doc, FONT_WAIT_MS, o.signal);

  const cap = createCapture(doc, el, mode, o);
  const vw = doc.documentElement.clientWidth || view.innerWidth;
  const vh = view.innerHeight;
  let dx: number;
  let dy: number;
  let width: number;
  let height: number;
  if (mode === "document") {
    const scroller = findMainScroller(doc);
    if (scroller) cap.shell = shellOf(scroller);
    dx = view.scrollX;
    dy = view.scrollY;
    width = vw;
    const se = doc.scrollingElement ?? doc.documentElement;
    height = Math.max(se.scrollHeight, doc.body?.scrollHeight ?? 0, vh) + (cap.shell?.delta ?? 0);
  } else {
    const r = el.getBoundingClientRect();
    if (elementScrolls(el)) cap.shell = shellOf(el);
    dx = -r.left;
    dy = -r.top;
    width = r.width;
    height = r.height + (cap.shell?.delta ?? 0);
  }
  cap.worldW = width;
  const bg = overrides.background ?? (mode === "document" ? documentBackground(doc, height) : elementBackground(el));
  for (const s of bg.sources) cap.bgSources.add(s);

  const ctx = rootContext(dx, dy, null);
  visit(cap, el, ctx);
  throwIfAborted(o.signal);

  if (o.detectDuplicates) detectDuplicates(cap.rootNode, cap.layers);
  if (o.screenshot) await applyScreenshot(doc, o.screenshot, cap.pendingShots, cap.layers);

  const ordered = paintOrder(cap.layers, cap.keys);
  const cut = truncate(ordered, o.maxLayers, cap.fixedIds, { x: dx, y: dy, w: vw, h: vh });
  let layers: Layer[] = cut.layers;
  const dropped = cut.dropped + cap.overflow;
  if (o.detectGuides && layers.length < o.maxLayers) {
    let seq = cap.seq;
    const params = {
      viewport: { w: vw, h: vh },
      height: Math.min(o.maxHeight, height),
      dpr: view.devicePixelRatio || 1,
    };
    const drafts = detectGuides(layers, cap.baselines, cap.fixedIds, params).slice(0, o.maxLayers - layers.length);
    layers = [...layers, ...applyGuides(drafts, () => `g${++seq}`)];
  }

  const worldH = Math.min(o.maxHeight, Math.max(height, cap.maxBottom));
  const size = { w: round2(width), h: round2(worldH) };
  const css = [overrides.css ?? "", fontFaceCss(doc, cap.shadowRoots, cap.families)]
    .filter((s) => s.length > 0)
    .join("\n");
  const bp: Blueprint = {
    version: 1,
    source: o.source ?? overrides.defaultSource ?? defaultSource(doc),
    size,
    viewport: { w: round2(vw), h: round2(vh) },
    background: bg.css,
    scheme: overrides.scheme ?? bg.scheme,
    layers,
  };
  if (css) bp.css = css;
  const icon = overrides.icon ?? (mode === "document" ? pageIcon(doc) : undefined);
  if (icon) bp.icon = icon;
  const truncated = truncationReason(o, dropped, cap.droppedHeight, cap.elementCapHit);
  if (truncated) bp.truncated = truncated;
  if (o.inlineImages) await inlineImages(doc, bp, o.signal);
  return bp;
}

/**
 * Walks the live DOM (including open shadow roots, slots and same-origin iframes) and builds a
 * Blueprint: styled boxes, rich text blocks, rules, images, media placeholders, form controls,
 * duplicates of repeated siblings and alignment guides.
 *
 * Computed styles and geometry are read in one pass without writes, except for the optional
 * `prescroll` pass (which restores the scroll position). Rejects with a TypeError/RangeError for
 * invalid arguments and with the signal's reason when aborted.
 */
export function snapshot(root: Element | Document, opts?: SnapshotOptions): Promise<Blueprint> {
  return capture(root, opts);
}
