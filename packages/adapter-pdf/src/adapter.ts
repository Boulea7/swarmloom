/** The PDF adapter: bytes -> pdf.js -> one rendered bitmap per page -> blueprint. */

import type { Adapter, AdapterContext, Blueprint, Layer, LoadedSource, SourceInput } from "@swarmloom/core";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { luminance } from "./bitmap";
import { abortError, fromPdfJs, PdfAdapterError } from "./errors";
import { hasPdfHeader, readPdfBytes } from "./input";
import { pageLayers } from "./layers";
import { type PdfAdapterOptions, type ResolvedOptions, resolveOptions } from "./options";
import { createCanvases, type PageScan, releaseCanvases, scanPage } from "./page";
import { getRuntime, type PdfRuntime, VERBOSITY_ERRORS } from "./runtime";
import { bodySize } from "./text";

/** Default when the context sets no `maxLayers` (matches the snapshot default). */
const DEFAULT_MAX_LAYERS = 6000;
/** Largest embedded image pdf.js decodes, in pixels; bigger ones are skipped instead of exhausting memory. */
const MAX_IMAGE_PIXELS = 64_000_000;

const BACKGROUND = { light: "#ececf1", dark: "#17171f" } as const;

/** File-type glyph the swarm orbits during the intro: a page with a folded corner and a coral band. Original artwork. */
export const PDF_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M12 4h17l9 9v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fafafc" stroke="#5b5bf7" stroke-width="2"/><path d="M29 4v9h9" fill="none" stroke="#5b5bf7" stroke-width="2" stroke-linejoin="round"/><rect x="6" y="25" width="28" height="11" rx="2.5" fill="#ff6b5b"/><path d="M15 18h16M15 40h17" stroke="#0b0b12" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/><path d="M10 28.5h3a2 2 0 0 1 0 4h-3v-4zm0 4v2M17 28.5v6h2a3 3 0 0 0 0-6h-2zM25 34.5v-6h5M25 31.5h4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}`;

let defaults: PdfAdapterOptions = {};

/**
 * Sets options for every PDF adapter that does not override them, including the
 * shared {@link pdfAdapter} that `@swarmloom/formats` loads. Shells call this to point
 * pdf.js at self-hosted worker, CMap, standard-font or wasm URLs.
 *
 * @throws RangeError when an option is invalid (nothing is changed then).
 */
export function configurePdfAdapter(options: PdfAdapterOptions): void {
  const next = { ...defaults, ...options };
  resolveOptions(next);
  defaults = next;
}

interface PageSlot {
  x: number;
  y: number;
}

interface Layout {
  scale: number;
  width: number;
  height: number;
  slots: PageSlot[];
}

/** Stacks pages vertically, centred, with the widest page fitting the context width (capped). */
function layoutPages(sizes: readonly { w: number; h: number }[], ctxWidth: number, maxPageWidth: number): Layout {
  const margin = Math.min(32, Math.max(12, Math.round(ctxWidth * 0.04)));
  const widest = Math.max(1, ...sizes.map((s) => s.w));
  const fit = Math.min(maxPageWidth, Math.max(160, ctxWidth - 2 * margin));
  const scale = fit / widest;
  const width = Math.max(Math.round(ctxWidth), Math.ceil(fit + 2 * margin));
  const slots: PageSlot[] = [];
  let y = margin;
  for (const s of sizes) {
    slots.push({ x: Math.round((width - s.w * scale) / 2), y });
    y += Math.ceil(s.h * scale) + margin;
  }
  return { scale, width, height: y, slots };
}

function devicePixelRatioOf(doc: Document): number {
  const dpr = doc.defaultView?.devicePixelRatio ?? 1;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

async function documentTitle(doc: PDFDocumentProxy): Promise<string | undefined> {
  const meta = await doc.getMetadata().catch(() => null);
  const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : undefined;
}

interface Cut {
  /** Pages shown in full. */
  shown: number;
  reason: string;
}

/** Keeps the cut that shows the fewest pages (the binding limit). */
function earliest(a: Cut | null, b: Cut): Cut {
  return a && a.shown <= b.shown ? a : b;
}

class PdfLoad {
  private readonly urls: string[] = [];

  constructor(
    private readonly o: ResolvedOptions,
    private readonly ctx: AdapterContext,
  ) {}

  async run(input: SourceInput): Promise<LoadedSource> {
    const { o, ctx } = this;
    const signal = ctx.signal;
    signal?.throwIfAborted();
    if (!(Number.isFinite(ctx.width) && ctx.width > 0))
      throw new RangeError(`ctx.width must be positive, got ${ctx.width}`);
    const bytes = await readPdfBytes(input, o.maxBytes, signal);
    const runtime = await getRuntime(o);
    signal?.throwIfAborted();
    const task = runtime.pdfjs.getDocument({
      data: bytes,
      worker: runtime.worker,
      password: o.password,
      cMapUrl: o.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: o.standardFontDataUrl,
      wasmUrl: o.wasmUrl,
      verbosity: VERBOSITY_ERRORS,
      ownerDocument: ctx.document,
      disableWorkerRendering: true,
      enableXfa: false,
      maxImageSize: MAX_IMAGE_PIXELS,
    });
    const onAbort = () => void task.destroy();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const doc = await task.promise.catch((error: unknown) => {
        throw signal?.aborted ? abortError(signal) : fromPdfJs(error);
      });
      const blueprint = await this.build(runtime, doc, input);
      return { blueprint, dispose: () => this.revoke() };
    } catch (error) {
      this.revoke();
      throw signal?.aborted ? abortError(signal) : error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await task.destroy().catch(() => undefined);
    }
  }

  private revoke(): void {
    for (const url of this.urls.splice(0)) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  private async build(runtime: PdfRuntime, doc: PDFDocumentProxy, input: SourceInput): Promise<Blueprint> {
    const { o, ctx } = this;
    const total = doc.numPages;
    let cut: Cut | null =
      total > o.maxPages ? { shown: o.maxPages, reason: `Showing the first ${o.maxPages} of ${total} pages` } : null;

    const pages: PDFPageProxy[] = [];
    for (let n = 1; n <= Math.min(total, o.maxPages); n++) {
      try {
        pages.push(await doc.getPage(n));
      } catch (error) {
        if (n === 1) throw fromPdfJs(error);
        cut = earliest(cut, {
          shown: n - 1,
          reason: `Page ${n} could not be read; showing ${n - 1} of ${total} pages`,
        });
        break;
      }
    }
    const base = pages.map((p) => p.getViewport({ scale: 1 }));
    const layout = layoutPages(
      base.map((v) => ({ w: v.width, h: v.height })),
      ctx.width,
      o.maxPageWidth,
    );

    const canvases = createCanvases(ctx.document);
    const scans: PageScan[] = [];
    try {
      for (const page of pages) {
        ctx.signal?.throwIfAborted();
        try {
          const scan = await scanPage(runtime.pdfjs, page, canvases, {
            scale: layout.scale,
            pixelRatio: o.pixelRatio ?? Math.min(2, Math.max(1, devicePixelRatioOf(ctx.document))),
            maxPagePixels: o.maxPagePixels,
            renderTimeoutMs: o.renderTimeoutMs,
            urlType: o.urlType,
            signal: ctx.signal,
          });
          this.urls.push(scan.src, ...(scan.backdrop ? [scan.backdrop] : []));
          scans.push(scan);
        } catch (error) {
          if (ctx.signal?.aborted || scans.length === 0) throw error;
          const n = page.pageNumber;
          cut = earliest(cut, {
            shown: n - 1,
            reason: `Page ${n} could not be rendered; showing ${n - 1} of ${total} pages`,
          });
          break;
        }
      }
    } finally {
      releaseCanvases(canvases);
    }

    const body = bodySize(scans.flatMap((s) => s.blocks));
    const budget = ctx.maxLayers ?? DEFAULT_MAX_LAYERS;
    const layers: Layer[] = [];
    let shown = 0;
    for (const scan of scans) {
      const page = pageLayers(scan, layout.slots[shown] as PageSlot, body, layers.length);
      if (layers.length + page.length > budget) {
        if (shown === 0) layers.push(...page.slice(0, Math.max(1, budget)));
        cut = earliest(cut, {
          shown,
          reason:
            shown === 0
              ? "Layer limit reached; page 1 is shown in part"
              : `Layer limit reached; showing ${shown} of ${total} pages`,
        });
        break;
      }
      layers.push(...page);
      shown++;
    }

    const last = shown > 0 ? (layout.slots[shown - 1] as PageSlot) : null;
    const lastScan = shown > 0 ? scans[shown - 1] : undefined;
    const margin = layout.slots[0]?.y ?? 0;
    const height = last && lastScan ? last.y + Math.ceil(lastScan.height) + margin : Math.max(layout.height, 1);
    const paper = scans[0]?.paper ?? [255, 255, 255];
    const blueprint: Blueprint = {
      version: 1,
      source: { type: "pdf", name: input.name, url: input.url, title: await documentTitle(doc) },
      size: { w: layout.width, h: height },
      background: BACKGROUND[ctx.theme === "dark" ? "dark" : "light"],
      scheme: luminance(paper) < 0.35 ? "dark" : "light",
      icon: PDF_ICON,
      layers,
    };
    if (cut) blueprint.truncated = { reason: cut.reason, dropped: total - cut.shown };
    return blueprint;
  }
}

/**
 * Creates a PDF adapter with its own options (merged over {@link configurePdfAdapter} defaults).
 *
 * The blueprint has one page box per page (paper colour, soft shadow), stacked with gaps and scaled so
 * the widest page fits `ctx.width` (at most `maxPageWidth`). Each page is rendered once by pdf.js; its
 * layers are crops of that bitmap: text lines typed (`reveal: "type"`, role heading or paragraph by font
 * size), figures swept, plus simple vector paths (rules, table lines, chart marks) redrawn as path layers.
 * `Blueprint.truncated.dropped` counts pages that are not shown.
 *
 * @throws RangeError when an option is invalid.
 */
export function createPdfAdapter(options: PdfAdapterOptions = {}): Adapter {
  resolveOptions(options);
  return {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    mime: ["application/pdf"],
    sniff: (head) => hasPdfHeader(head),
    /**
     * @throws PdfAdapterError (`code`: input, too-large, invalid, password, render); the signal's reason when aborted.
     */
    load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      return new PdfLoad(resolveOptions({ ...defaults, ...options }), ctx).run(input);
    },
  };
}

export { PdfAdapterError };
