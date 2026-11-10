/**
 * Renders one PDF page once at device scale and extracts everything the
 * blueprint needs from it: the bitmap URL, text lines, vector shapes,
 * bitmap regions and the ink map.
 */

import type { PDFPageProxy } from "pdfjs-dist";
import { context2d, encodePng, fitRatio, scanInk } from "./bitmap";
import type { Rgb } from "./coverage";
import { abortError, PdfAdapterError } from "./errors";
import type { Edges, Matrix } from "./geometry";
import { type PagePlan, planPage, textHoles } from "./layers";
import { checkOps, type PaintScan, walkOperators } from "./operators";
import type { PdfJs } from "./runtime";
import { groupBlocks, groupLines, type PdfTextStyle, type TextBlock, toRuns } from "./text";

/** Reused across pages so one load holds at most two full-size canvases. */
export interface Canvases {
  page: HTMLCanvasElement;
  /** Transparent copy of the page with text lines punched out. */
  backdrop: HTMLCanvasElement;
  /** About one pixel per CSS px, read back for the ink scan. */
  scan: HTMLCanvasElement;
}

export interface PageRenderOptions {
  /** CSS px per PDF unit, shared by every page so relative sizes stay true. */
  scale: number;
  pixelRatio: number;
  maxPagePixels: number;
  renderTimeoutMs: number;
  urlType: "blob" | "data";
  signal?: AbortSignal;
}

export interface PageScan {
  /** 1-based page number. */
  number: number;
  width: number;
  height: number;
  /** Bitmap URL and its size in device px. */
  src: string;
  natural: { w: number; h: number };
  /** Device px per CSS px actually used (after the pixel budget). */
  ratio: number;
  blocks: TextBlock[];
  /** Text items pdf.js reported with visible characters. */
  textItems: number;
  paint: PaintScan;
  /** Paper colour detected on the bitmap. */
  paper: Rgb;
  plan: PagePlan;
  /** Bitmap for figure and stray-ink crops when they overlap text; otherwise they use `src`. */
  backdrop?: string;
}

/** What planning needs from a page (everything except the plan itself). */
export type PageBasics = Omit<PageScan, "plan" | "backdrop">;

export function createCanvases(doc: Document): Canvases {
  return {
    page: doc.createElement("canvas"),
    backdrop: doc.createElement("canvas"),
    scan: doc.createElement("canvas"),
  };
}

/** Shrinks both canvases to nothing so the browser can reclaim their backing stores right away. */
export function releaseCanvases(c: Canvases): void {
  for (const canvas of [c.page, c.backdrop, c.scan]) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function renderBitmap(
  pdfjs: PdfJs,
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
  ratio: number,
  o: PageRenderOptions,
): Promise<void> {
  context2d(canvas);
  const task = page.render({
    canvas,
    viewport,
    // One uniform ratio for both axes, so crop rects map back to CSS px exactly.
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    background: "#ffffff",
    annotationMode: pdfjs.AnnotationMode.ENABLE,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => task.cancel();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          task.cancel();
          reject(
            new PdfAdapterError("render", `Page ${page.pageNumber} took longer than ${o.renderTimeoutMs} ms to render`),
          );
        }, o.renderTimeoutMs);
      }),
    ]);
  } catch (error) {
    if (o.signal?.aborted) throw abortError(o.signal);
    if (error instanceof PdfAdapterError) throw error;
    throw new PdfAdapterError("render", `Page ${page.pageNumber} could not be rendered`, { cause: error });
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Renders and analyses one page.
 *
 * @throws PdfAdapterError "render" when the bitmap cannot be produced; text and operator
 *   failures only degrade the result (their regions are still revealed from the bitmap).
 */
export async function scanPage(
  pdfjs: PdfJs,
  page: PDFPageProxy,
  canvases: Canvases,
  o: PageRenderOptions,
): Promise<PageScan> {
  const viewport = page.getViewport({ scale: o.scale });
  const ratio = fitRatio(viewport.width, viewport.height, o.pixelRatio, o.maxPagePixels);
  const canvas = canvases.page;
  canvas.width = Math.max(1, Math.ceil(viewport.width * ratio));
  canvas.height = Math.max(1, Math.ceil(viewport.height * ratio));

  const ops = checkOps(pdfjs.OPS as unknown as Record<string, number>);
  const [, text, opList] = await Promise.all([
    renderBitmap(pdfjs, page, canvas, viewport, ratio, o),
    page.getTextContent().catch(() => null),
    ops ? page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE }).catch(() => null) : null,
  ]);
  if (o.signal?.aborted) throw abortError(o.signal);

  const frame = {
    transform: viewport.transform as unknown as Matrix,
    scale: o.scale,
    width: viewport.width,
    height: viewport.height,
  };
  const runs = text ? toRuns(text.items, text.styles as Record<string, PdfTextStyle>, frame) : [];
  const paint =
    ops && opList
      ? walkOperators(opList, ops, { ...frame, minStroke: 1 / ratio })
      : { shapes: [], regions: [], complete: false };
  const ink = scanInk(canvas, canvases.scan, viewport.width, viewport.height);
  const src = await encodePng(canvas, o.urlType);
  page.cleanup();
  const scan: PageBasics = {
    number: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    src,
    natural: { w: canvas.width, h: canvas.height },
    ratio,
    blocks: groupBlocks(groupLines(runs)),
    textItems: runs.length,
    paint,
    paper: ink.paper,
  };
  const plan = planPage(scan, ink.map);
  if (!plan.needsBackdrop) return { ...scan, plan };
  try {
    const backdrop = await encodeBackdrop(canvas, canvases.backdrop, textHoles(plan), o.urlType);
    return { ...scan, plan, backdrop };
  } catch {
    // Figures then crop the full bitmap: still pixel-exact, they may just show text before it is typed.
    return { ...scan, plan };
  }
}

/** Copies the page onto a transparent canvas, clears the text-line rects and encodes it. */
async function encodeBackdrop(
  page: HTMLCanvasElement,
  target: HTMLCanvasElement,
  holes: readonly Edges[],
  urlType: "blob" | "data",
): Promise<string> {
  target.width = page.width;
  target.height = page.height;
  const ctx = target.getContext("2d");
  if (!ctx) throw new PdfAdapterError("render", "Canvas 2D is not available in this environment");
  ctx.drawImage(page, 0, 0);
  for (const h of holes) ctx.clearRect(h.x0, h.y0, h.x1 - h.x0, h.y1 - h.y0);
  return encodePng(target, urlType);
}
