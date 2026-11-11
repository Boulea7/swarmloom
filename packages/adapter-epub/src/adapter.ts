import {
  AssetUrls,
  type BudgetLimits,
  ContentBudget,
  checkContext,
  DEFAULT_BUDGET,
  DESK_PAD,
  type DocumentAdapter,
  DocumentError,
  documentIcon,
  escapeHtml,
  FontReport,
  firstZipEntry,
  imageSize,
  type LoadedDocument,
  loaded,
  openSheet,
  readBytes,
  type SheetSpec,
  type SnapshotHtml,
  snapshotSheets,
  ZipArchive,
} from "@swarmloom/adapter-odf/kit";
import type { AdapterContext, SourceInput } from "@swarmloom/core";
import { type Book, readBook, type TocEntry } from "./book";
import { BookRenderer, type BookStats } from "./chapter";

/** Options of {@link createEpubAdapter}. */
export interface EpubAdapterOptions {
  /** Reject inputs larger than this. Default 100 MiB. */
  maxBytes?: number;
  /** Long-input budget (S10). Default {@link DEFAULT_BUDGET}. */
  budget?: Partial<BudgetLimits>;
  /** Most content documents rendered. Default 24. */
  maxChapters?: number;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshotHtml?: SnapshotHtml;
}

const ID = "epub";
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_CHAPTERS = 24;
/** Widest reflowed page, in CSS px. */
const PAGE_MAX = 760;
const PAGE_MIN = 360;
/** Widest fixed-layout page before it is zoomed out. */
const FIXED_MAX = 900;
const OUTLINE_ENTRIES = 20;
const XHTML_TYPES = new Set(["application/xhtml+xml", "text/html", "application/xml", "text/xml", ""]);

const BASE_CSS = [
  ".epub-page{padding:56px 64px 64px;font-family:'Noto Serif','Liberation Serif','Noto Serif SC',serif;font-size:17px;line-height:1.6;}",
  ".epub-page .epub-html,.epub-page .epub-body{display:block;}",
  ".epub-body img,.epub-body svg{max-width:100%;height:auto;}",
  ".epub-body p{margin:0 0 .8em;}",
  ".epub-body h1,.epub-body h2,.epub-body h3{line-height:1.25;margin:1.2em 0 .6em;}",
  ".epub-body table{border-collapse:collapse;}",
  ".epub-body pre{white-space:pre-wrap;}",
  ".epub-link{color:#2563eb;text-decoration:underline;}",
  ".epub-fixed .epub-html{position:relative;overflow:hidden;transform-origin:0 0;}",
  ".epub-cover img,.epub-picture img{display:block;width:100%;height:100%;object-fit:contain;}",
].join("");

/** True for EPUB containers: the first ZIP entry is a stored `mimetype` of `application/epub+zip`. */
export function sniffEpub(head: Uint8Array): boolean {
  const first = firstZipEntry(head);
  return (
    !!first &&
    first.name === "mimetype" &&
    !!first.stored &&
    new TextDecoder().decode(first.stored).trim() === "application/epub+zip"
  );
}

/** Outline note: the first entries of the table of contents. */
export function outlineNote(toc: readonly TocEntry[]): string | undefined {
  if (toc.length === 0) return undefined;
  const shown = toc.slice(0, OUTLINE_ENTRIES).map((e) => `${"  ".repeat(Math.min(e.depth, 3))}${e.label}`);
  const more = toc.length > OUTLINE_ENTRIES ? ` (+${toc.length - OUTLINE_ENTRIES} more)` : "";
  return `Outline: ${shown.map((s) => s.trim()).join(" / ")}${more}.`;
}

function statsNotes(stats: BookStats, failed: number): string[] {
  const notes: string[] = [];
  if (stats.missingImages > 0)
    notes.push(
      `${stats.missingImages} image(s) could not be shown (missing, linked externally or not a supported type).`,
    );
  if (stats.obfuscatedFonts > 0) notes.push("Obfuscated embedded fonts were replaced by fallback fonts.");
  if (stats.scripts > 0) notes.push("Scripts in the book were not run.");
  if (failed > 0) notes.push(`${failed} chapter(s) could not be read and were skipped.`);
  return notes;
}

interface Pages {
  html: string[];
  sheets: SheetSpec[];
}

function addPicture(
  pages: Pages,
  url: string,
  size: { w: number; h: number } | undefined,
  width: number,
  cls: string,
  label: string,
): void {
  const ratio = size && size.w > 0 && size.h > 0 ? size.h / size.w : 1.5;
  const spec: SheetSpec = { w: width, h: Math.round(width * Math.min(1.8, Math.max(0.5, ratio))), fixed: true };
  pages.sheets.push(spec);
  pages.html.push(`${openSheet(spec, { className: cls, label })}<img src="${escapeHtml(url)}" alt=""></section>`);
}

/** Registers the book's embedded fonts in the stage document; returns a function that removes them. */
async function registerFonts(doc: Document, win: Window, renderer: BookRenderer): Promise<() => void> {
  const Face = (win as unknown as { FontFace?: typeof FontFace }).FontFace;
  const set = doc.fonts as FontFaceSet | undefined;
  if (!Face || !set) return () => {};
  const added: FontFace[] = [];
  for (const spec of renderer.fonts()) {
    const file = renderer.fontBytes(spec.path);
    if (!file) continue;
    try {
      const descriptors: FontFaceDescriptors = {};
      if (spec.weight) descriptors.weight = spec.weight;
      if (spec.style) descriptors.style = spec.style;
      const face = new Face(spec.family, file.bytes.slice().buffer, descriptors);
      await face.load();
      set.add(face);
      added.push(face);
    } catch {
      // A broken font file falls back to the stack; it is not worth failing the book for.
    }
  }
  return () => {
    for (const face of added) set.delete(face);
  };
}

function pageWidth(ctx: AdapterContext): number {
  return Math.round(Math.min(PAGE_MAX, Math.max(PAGE_MIN, ctx.width - 2 * DESK_PAD)));
}

function renderBook(
  zip: ZipArchive,
  book: Book,
  renderer: BookRenderer,
  budget: ContentBudget,
  ctx: AdapterContext,
  maxChapters: number,
) {
  const width = pageWidth(ctx);
  const pages: Pages = { html: [], sheets: [] };
  let coverUrl: string | null = null;
  if (book.coverImage && !book.fixedLayout && zip.has(book.coverImage)) {
    coverUrl = renderer.image(book.coverImage);
    if (coverUrl) {
      addPicture(pages, coverUrl, imageSize(zip.read(book.coverImage)), width, "epub-cover", "Cover");
      budget.take(0);
    }
  }
  let failed = 0;
  let chapters = 0;
  const linear = book.spine.filter((s) => s.linear);
  for (let i = 0; i < linear.length; i++) {
    const item = (linear[i] as (typeof linear)[number]).item;
    if (budget.exhausted || chapters >= maxChapters) {
      budget.skip(linear.length - i);
      break;
    }
    ctx.signal?.throwIfAborted();
    if (item.mediaType.startsWith("image/")) {
      if (item.path === book.coverImage && coverUrl) continue;
      const url = renderer.image(item.path);
      if (url && budget.take(0)) {
        addPicture(pages, url, imageSize(zip.read(item.path)), width, "epub-picture", "Picture");
        chapters++;
      }
      continue;
    }
    if (!XHTML_TYPES.has(item.mediaType) || !zip.has(item.path)) {
      failed++;
      continue;
    }
    let chapter: ReturnType<BookRenderer["chapter"]>;
    try {
      chapter = renderer.chapter(item.path, budget);
    } catch (error) {
      if (!(error instanceof DocumentError) || error.code === "encrypted") throw error;
      failed++;
      continue;
    }
    if (chapter.pictureOnly && coverUrl && chapter.pictureOnly === coverUrl) continue;
    if (chapter.html.trim() === "") continue;
    const lang = book.language ? ` lang="${escapeHtml(book.language)}"` : "";
    const body = `<div class="epub-body ${chapter.bodyClass}">${chapter.html}</div>`;
    if (book.fixedLayout) {
      const vp = chapter.viewport ?? book.viewport ?? { w: 600, h: 800 };
      const scale = Math.min(1, FIXED_MAX / vp.w);
      const spec: SheetSpec = { w: Math.round(vp.w * scale), h: Math.round(vp.h * scale), fixed: true };
      const zoom = scale < 1 ? `transform:scale(${scale.toFixed(4)});` : "";
      pages.sheets.push(spec);
      pages.html.push(
        `${openSheet(spec, { className: "epub-fixed" })}<div class="epub-html ${chapter.htmlClass}"${lang} style="width:${vp.w}px;height:${vp.h}px;${zoom}">${body}</div></section>`,
      );
    } else {
      const spec: SheetSpec = { w: width, h: Math.round(width * 1.35) };
      pages.sheets.push(spec);
      pages.html.push(
        `${openSheet(spec, { className: "epub-page" })}<div class="epub-html ${chapter.htmlClass}"${lang}>${body}</div></section>`,
      );
    }
    chapters++;
  }
  return { pages, failed };
}

/**
 * Creates the EPUB adapter (EPUB 2 and 3): META-INF/container.xml -> package document -> spine.
 * The cover and the first chapters (within the long-input budget) become page sheets; content is
 * sanitised with DOMPurify, the book's CSS is scoped to its chapters, images come from the archive
 * as blob URLs and the table of contents is reported as an outline note. DRM-protected books are
 * refused with a clear error.
 */
export function createEpubAdapter(options: EpubAdapterOptions = {}): DocumentAdapter {
  return {
    id: ID,
    label: "EPUB e-book",
    extensions: ["epub"],
    mime: ["application/epub+zip"],
    sniff: sniffEpub,
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedDocument> {
      checkContext(ctx, ID);
      const src = await readBytes(input, {
        format: ID,
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
      });
      const win = ctx.document.defaultView;
      if (!win) throw new TypeError(`${ID}: ctx.document needs a window`);
      const zip = ZipArchive.open(src.bytes, ID);
      const book = readBook(zip, win);
      const assets = new AssetUrls(win.URL, win.Blob);
      let removeFonts = () => {};
      try {
        const fonts = new FontReport();
        const renderer = new BookRenderer(zip, book, assets, win, fonts);
        const budget = new ContentBudget({ ...DEFAULT_BUDGET, ...options.budget });
        const { pages, failed } = renderBook(
          zip,
          book,
          renderer,
          budget,
          ctx,
          options.maxChapters ?? DEFAULT_MAX_CHAPTERS,
        );
        if (pages.sheets.length === 0) throw new DocumentError(ID, "empty", "the book has no readable content");
        removeFonts = await registerFonts(ctx.document, win, renderer);
        ctx.signal?.throwIfAborted();
        const title = book.title ?? src.name;
        const blueprint = await snapshotSheets(
          { html: pages.html.join(""), css: BASE_CSS + renderer.css(), sheets: pages.sheets, role: "page" },
          {
            ctx,
            icon: documentIcon("EPUB", "#A855F7"),
            source: {
              type: ID,
              ...(src.name ? { name: src.name } : {}),
              ...(title ? { title } : {}),
              ...(src.url ? { url: src.url } : {}),
            },
            ...(options.snapshotHtml ? { snapshotHtml: options.snapshotHtml } : {}),
            ...(budget.dropped > 0
              ? {
                  truncated: {
                    reason: "Long book: only the cover and the first chapters were woven.",
                    dropped: budget.dropped,
                  },
                }
              : {}),
          },
        );
        const remove = removeFonts;
        return loaded(blueprint, [outlineNote(book.toc), fonts.note(), ...statsNotes(renderer.stats, failed)], () => {
          remove();
          assets.revokeAll();
        });
      } catch (error) {
        removeFonts();
        assets.revokeAll();
        throw error;
      }
    },
  };
}

/** EPUB adapter with default options (id "epub"). */
export const epubAdapter: DocumentAdapter = createEpubAdapter();
