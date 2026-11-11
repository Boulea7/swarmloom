import type { Blueprint, BlueprintSource, Layer } from "@swarmloom/core";
import { elementScrolls, findMainScroller, prescroll, shellOf } from "./capture/scroller";
import { type Capture, createCapture } from "./capture/state";
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
import { runSliced, type SliceGuard, yieldToHost } from "./util/slice";

/** Live pages wait at most this long for web fonts before capture. */
const FONT_WAIT_MS = 1500;

/** Sliced walks torn by a reflow before the last one runs synchronously. */
const SLICED_WALKS = 2;

/** Frontier movement (px) between slices that counts as a reflow. */
const REFLOW_PX = 0.5;

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

/**
 * Returns a function that puts the window and app-shell scroll positions back when the user or
 * the page moved them between walk slices: rects read after a yield must stay comparable with
 * the offsets taken at the start.
 */
function scrollKeeper(view: Window, shell: Element | null): () => void {
  const x = view.scrollX;
  const y = view.scrollY;
  const sx = shell?.scrollLeft ?? 0;
  const sy = shell?.scrollTop ?? 0;
  return () => {
    if (view.scrollX !== x || view.scrollY !== y) view.scrollTo({ left: x, top: y, behavior: "instant" });
    if (shell && (shell.scrollLeft !== sx || shell.scrollTop !== sy)) {
      shell.scrollTo({ left: sx, top: sy, behavior: "instant" });
    }
  };
}

/** Viewport positions of the capture root (with its width) and of the walk frontier. */
function frontierMarks(cap: Capture): number[] {
  const r = cap.root.getBoundingClientRect();
  const marks = [r.left, r.top, r.width];
  for (const el of [cap.frontier.next, cap.frontier.flow]) {
    const f = el?.getBoundingClientRect();
    marks.push(f?.left ?? 0, f?.top ?? 0);
  }
  return marks;
}

/**
 * Keeps one layout across walk slices. Page timers, image and font loads run during the host's
 * turns; a reflow there would mix rects read before and after it (rows that jump, overlap or run
 * past the world). After each turn the scroll positions are put back and the walk is stopped when
 * the root or the frontier moved: content after the frontier is read later anyway, so only a
 * change to what was already walked tears the result.
 */
function layoutGuard(view: Window, cap: Capture): SliceGuard {
  const keepScroll = scrollKeeper(view, cap.shell?.el ?? null);
  let before: number[] = [];
  return {
    pause: () => {
      before = frontierMarks(cap);
    },
    resume: () => {
      keepScroll();
      const after = frontierMarks(cap);
      return after.every((v, i) => Math.abs(v - (before[i] ?? v)) <= REFLOW_PX);
    },
  };
}

/** Gives the host a turn between post-processing passes and honours an abort. */
async function pause(signal: AbortSignal | undefined): Promise<void> {
  await yieldToHost();
  throwIfAborted(signal);
}

/** A walk's capture state and the page geometry it was measured against. */
interface Walked {
  cap: Capture;
  vw: number;
  vh: number;
  /** Viewport -> world offset. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  bg: PageBackground;
}

/** Measures the page (or the root element) and creates a fresh capture for one walk. */
function prepareWalk(
  doc: Document,
  el: Element,
  mode: "document" | "element",
  o: ResolvedOptions,
  overrides: CaptureOverrides,
): Walked {
  const view = viewOf(doc);
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
  return { cap, vw, vh, dx, dy, width, height, bg };
}

/**
 * Walks the tree in time slices (behavior-spec §3.8 step 6), so the page stays responsive and an
 * abort is honoured within one slice. A walk torn by a reflow between slices is thrown away and
 * started again from fresh measurements; after SLICED_WALKS torn walks the last one runs in one
 * task, so a page that keeps reflowing is still read in a single layout.
 */
async function walk(
  doc: Document,
  el: Element,
  mode: "document" | "element",
  o: ResolvedOptions,
  overrides: CaptureOverrides,
): Promise<Walked> {
  for (let attempt = 1; ; attempt++) {
    const w = prepareWalk(doc, el, mode, o, overrides);
    const work = visit(w.cap, el, rootContext(w.dx, w.dy, null));
    if (attempt > SLICED_WALKS) {
      // A fresh capture's slice deadline is infinite: the walk runs to the end without yielding.
      work.next();
      return w;
    }
    if (await runSliced(work, w.cap.slice, o.signal, layoutGuard(viewOf(doc), w.cap))) return w;
  }
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

  const { cap, vw, vh, dx, dy, width, height, bg } = await walk(doc, el, mode, o, overrides);
  await pause(o.signal);

  if (o.detectDuplicates) detectDuplicates(cap.rootNode, cap.layers);
  if (o.screenshot) await applyScreenshot(doc, o.screenshot, cap.pendingShots, cap.layers);
  await pause(o.signal);

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
 * `prescroll` pass and scroll positions put back after a slice (both restore the original
 * position). The walk runs in slices of about 10 ms, so the page stays responsive and `signal`
 * aborts within one slice. When the page reflows what was already walked between two slices (an
 * image or font loads, a timer grows a banner), the walk starts over; after two torn walks the
 * last one runs in a single task, so the Blueprint always reflects one layout. Rejects with a
 * TypeError/RangeError for invalid arguments and with the signal's reason when aborted.
 */
export function snapshot(root: Element | Document, opts?: SnapshotOptions): Promise<Blueprint> {
  return capture(root, opts);
}
