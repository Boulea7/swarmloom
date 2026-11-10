import type { Adapter, AdapterContext, Blueprint, LoadedSource, SourceInput } from "@swarmloom/core";
import { DocxError } from "./errors";
import {
  coreTitle,
  type DocxPackage,
  headingStyles,
  openDocxPackage,
  type ParagraphStyle,
  paragraphStyles,
} from "./package";
import { fontSubstitutionNote, primaryFamilies, rewriteFontFamilies, withFontFallbacks } from "./paged/fonts";
import { documentIcon } from "./paged/icon";
import { readInputBytes } from "./paged/input";
import { MARKER_CSS, materializeMarkers } from "./paged/markers";
import { createSandbox, reparseContent, type Sandbox } from "./paged/sandbox";
import { sanitizeCss, sanitizeTree } from "./paged/sanitize";
import { type SnapshotHtmlFn, snapshotPaged } from "./paged/snapshot";
import { deskCss } from "./paged/theme";
import { PLAIN_DESK, PLAIN_PAGE, plainCss, renderPlain } from "./plain";
import { fitSheets, hasOverfullSheets, markHeadings, PREVIEW_CLASS, PREVIEW_WRAPPER, renderPreview } from "./preview";

export { DocxError, type DocxErrorCode } from "./errors";
export { checkXml, MAX_XML_DEPTH } from "./xml";
export { checkDocxPackage, DEFAULT_ZIP_LIMITS, isSafeEntryName, type ZipLimits } from "./zip";

/** Largest DOCX accepted, bytes (product-spec A.1: 100 MB in Studio). */
export const MAX_DOCX_BYTES = 100 * 1024 * 1024;

/** Which renderer produced the page sheets. */
export type DocxRenderer = "preview" | "plain";

/** Options of {@link loadDocx} and {@link createDocxAdapter}. */
export interface DocxLoadOptions {
  /**
   * "auto" (default) renders with docx-preview and falls back to the built-in plain renderer when it
   * fails; "preview" fails instead of falling back; "plain" uses only the built-in renderer.
   */
  renderer?: "auto" | DocxRenderer;
  /**
   * Also start sheets at the page breaks Word saved when the file was last laid out
   * (`w:lastRenderedPageBreak`, default true). Sections and explicit page breaks always start sheets.
   */
  savedPageBreaks?: boolean;
  /** Largest accepted file, bytes (default {@link MAX_DOCX_BYTES}). */
  maxBytes?: number;
  /** Replaces snapshot-dom's `snapshotHtml` (tests, custom pipelines). */
  snapshotHtml?: SnapshotHtmlFn;
}

/** Result of loading a DOCX: the blueprint plus quality notes and how it was paged. */
export interface DocxLoadedSource extends LoadedSource {
  /** Plain-English quality notes (fallback renderer, font substitutes, pagination); may be empty. */
  notes: string[];
  /** Number of page sheets. */
  pages: number;
  /** The renderer that produced the sheets. */
  renderer: DocxRenderer;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 16384;

/** Added when a sheet runs well past its page height: sheets follow the file's breaks, not Word's live pagination. */
export const PAGINATION_NOTE =
  "Pages start at section and page breaks saved in the document; Word's automatic page flow is not recalculated, so some pages are longer than in Word.";

interface Rendered {
  pages: HTMLElement[];
  renderer: DocxRenderer;
  heading?: string;
  notes: string[];
}

/**
 * Loads a Word document (.docx): validates the package (size, ZIP limits, XML safety), renders it as
 * page sheets with docx-preview or, if that fails, with the built-in plain renderer, and snapshots the
 * sheets into a blueprint whose pages are "page" box layers holding their content.
 *
 * Sheets come only from section starts, explicit page breaks and (optionally) Word's saved page
 * breaks; Word's automatic pagination is never imitated.
 *
 * @throws DocxError for files that are not DOCX, encrypted, legacy .doc, oversized, damaged or unsafe,
 *   or ("render-failed") when no renderer could lay the document out. InputError for missing input.
 */
export async function loadDocx(
  input: SourceInput,
  ctx: AdapterContext,
  options: DocxLoadOptions = {},
): Promise<DocxLoadedSource> {
  const bytes = await readInputBytes(input, ctx, options.maxBytes ?? MAX_DOCX_BYTES);
  ctx.signal?.throwIfAborted();
  const pkg = await openDocxPackage(bytes);
  ctx.signal?.throwIfAborted();
  const styles = paragraphStyles(pkg);
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Number.isFinite(ctx.width) ? ctx.width : 0)));
  const savedPageBreaks = options.savedPageBreaks ?? true;
  const mode = options.renderer ?? "auto";

  let sandbox = createSandbox(ctx.document, width);
  try {
    let rendered: Rendered | null = null;
    let failure: unknown;
    if (mode !== "plain") {
      try {
        rendered = await previewSheets(bytes, sandbox, styles, ctx, savedPageBreaks);
      } catch (cause) {
        ctx.signal?.throwIfAborted();
        if (mode === "preview") throw new DocxError("render-failed", errorText(cause), { cause });
        failure = cause;
        sandbox.dispose();
        sandbox = createSandbox(ctx.document, width);
      }
    }
    if (!rendered) {
      try {
        rendered = plainSheets(pkg, sandbox, styles, ctx, savedPageBreaks);
      } catch (cause) {
        if (cause instanceof DocxError) throw cause;
        throw new DocxError("render-failed", errorText(failure ?? cause), { cause });
      }
      if (failure !== undefined) {
        rendered.notes.unshift(
          `The full renderer could not lay out this document (${errorText(failure)}), so a simplified view is shown.`,
        );
      }
    }
    ctx.signal?.throwIfAborted();
    const notes = [...rendered.notes];
    const fonts = fontSubstitutionNote(ctx.document, documentFonts(sandbox));
    if (fonts) notes.push(fonts);
    if (hasOverfullSheets(rendered.pages)) notes.push(PAGINATION_NOTE);
    const title = coreTitle(pkg) ?? rendered.heading ?? stripExtension(input.name);
    const blueprint: Blueprint = await snapshotPaged({
      sandbox,
      pages: rendered.pages,
      ctx,
      source: { type: "docx", name: input.name, url: input.url, title },
      icon: documentIcon("DOCX"),
      snapshotHtml: options.snapshotHtml,
    });
    return { blueprint, notes, pages: rendered.pages.length, renderer: rendered.renderer };
  } finally {
    sandbox.dispose();
  }
}

/**
 * Base typography for the sheets, so text inherits the same values in the measuring sandbox and in
 * snapshot-dom's sandbox (whose root sets its own font, line height and wrapping).
 */
function baseCss(desk: string): string {
  return `
${desk} { font: 400 11pt/normal ${withFontFallbacks("Calibri")}; color: #000000; letter-spacing: normal;
  word-spacing: normal; text-transform: none; text-align: start; text-indent: 0; white-space: normal;
  overflow-wrap: normal; word-break: normal; font-variant: normal; font-kerning: auto; direction: ltr; }
${desk} img, ${desk} svg, ${desk} video { max-width: 100%; }
`;
}

async function previewSheets(
  bytes: Uint8Array,
  sandbox: Sandbox,
  styles: ReadonlyMap<string, ParagraphStyle>,
  ctx: AdapterContext,
  savedPageBreaks: boolean,
): Promise<Rendered> {
  const rendered = await renderPreview(bytes, sandbox.root, sandbox.styles, { savedPageBreaks });
  if (rendered.length === 0) throw new Error("no pages were produced");
  ctx.signal?.throwIfAborted();
  sanitizeTree(sandbox.root);
  // docx-preview builds DOM that HTML parsing restructures; lay out what snapshot-dom will parse.
  const pages = reparseContent(sandbox.root, rendered);
  for (const node of Array.from(sandbox.styles.children)) {
    if (node.localName !== "style") node.remove();
    else node.textContent = rewriteFontFamilies(sanitizeCss(node.textContent ?? ""));
  }
  for (const el of Array.from(sandbox.root.querySelectorAll<HTMLElement>("[style*='font-family']"))) {
    if (el.style.fontFamily) el.style.fontFamily = withFontFallbacks(el.style.fontFamily);
  }
  const heading = markHeadings(sandbox.root, headingStyles(styles));
  fitSheets(pages, sandbox.width);
  const desk = `.${PREVIEW_WRAPPER}`;
  sandbox.addCss(baseCss(desk) + deskCss(desk, `section.${PREVIEW_CLASS}`, ctx.theme, sandbox.width) + MARKER_CSS);
  materializeMarkers(sandbox.root);
  return { pages, renderer: "preview", heading, notes: [] };
}

function plainSheets(
  pkg: DocxPackage,
  sandbox: Sandbox,
  styles: ReadonlyMap<string, ParagraphStyle>,
  ctx: AdapterContext,
  savedPageBreaks: boolean,
): Rendered {
  const desk = `.${PLAIN_DESK}`;
  sandbox.addCss(baseCss(desk) + plainCss() + deskCss(desk, `section.${PLAIN_PAGE}`, ctx.theme, sandbox.width));
  const result = renderPlain(pkg, sandbox.root, { styles, savedPageBreaks });
  sanitizeTree(sandbox.root);
  fitSheets(result.pages, sandbox.width);
  const notes: string[] = [];
  const { pictures, footnotes, headersFooters } = result.omitted;
  const left = [
    pictures > 0 ? `${pictures} picture${pictures === 1 ? "" : "s"}` : "",
    headersFooters ? "headers and footers" : "",
    footnotes > 0 ? "footnotes" : "",
  ].filter(Boolean);
  if (left.length > 0) notes.push(`The simplified view leaves out ${left.join(", ")}.`);
  const heading = sandbox.root.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")?.textContent?.trim();
  return { pages: result.pages, renderer: "plain", heading: heading || undefined, notes };
}

/** The first concrete font of every font-family list the rendered document uses. */
function documentFonts(sandbox: Sandbox): string[] {
  const inline = Array.from(
    sandbox.root.querySelectorAll<HTMLElement>("[style*='font-family']"),
    (el) => `font-family: ${el.style.fontFamily};`,
  );
  const css = sandbox
    .css()
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/\.swl-marker[^{]*\{[^}]*\}/g, "");
  return primaryFamilies(`${css}\n${inline.join("\n")}`);
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function stripExtension(name: string | undefined): string | undefined {
  return name?.replace(/\.[^.]+$/, "") || undefined;
}

/** Creates the DOCX adapter with custom options (renderer choice, saved page breaks, test snapshotter). */
export function createDocxAdapter(options: DocxLoadOptions = {}): Adapter {
  return {
    id: "docx",
    label: "Word document",
    extensions: ["docx"],
    mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    load: (input, ctx) => loadDocx(input, ctx, options),
  };
}

/**
 * DOCX adapter: Word document -> page sheets (docx-preview, built-in plain fallback) -> snapshot-dom.
 * The result is a {@link DocxLoadedSource} with quality notes.
 */
export const docxAdapter: Adapter = createDocxAdapter();

export default docxAdapter;
