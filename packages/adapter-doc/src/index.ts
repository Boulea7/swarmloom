import { loadDocx } from "@swarmloom/adapter-docx";
import {
  createSandbox,
  documentIcon,
  fontSubstitutionNote,
  primaryFamilies,
  readInputBytes,
  type SnapshotHtmlFn,
  snapshotPaged,
} from "@swarmloom/adapter-docx/paged";
import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import { type DocContainer, detectDocContainer } from "./detect";
import { DocError } from "./errors";
import type { DocModel } from "./model";
import { MAX_DOC_BYTES, parseDoc } from "./parser/document";
import { docCss } from "./render/css";
import { type DocRenderMode, renderDoc } from "./render/dom";

export { type DocContainer, detectDocContainer } from "./detect";
export { DocError, type DocErrorCode } from "./errors";
export type * from "./model";
export { MAX_DOC_BYTES, type ParseDocOptions, parseDoc } from "./parser/document";
export type { DocRenderMode } from "./render/dom";

/** Options of {@link loadDoc} and {@link createDocAdapter}. */
export interface DocAdapterOptions {
  /**
   * "text" (default): text and structure in one body font, no pictures or character formatting.
   * "rich": also fonts, sizes, colours, emphasis and inline PNG/JPEG pictures (best effort).
   */
  mode?: DocRenderMode;
  /** Replaces snapshot-dom's `snapshotHtml` (tests, custom pipelines). */
  snapshotHtml?: SnapshotHtmlFn;
}

/** Result of loading a DOC: the blueprint plus quality notes and how it was shown. */
export interface DocLoadedSource extends LoadedSource {
  /** Plain-English notes about skipped or approximated content; may be empty. */
  notes: string[];
  /** Number of page sheets (from section and explicit page breaks only). */
  pages: number;
  /** How the file was shown: a DOC in text or rich mode, or a Word 2007+ package with a .doc name. */
  view: DocRenderMode | "docx";
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 16384;

/** Shown for every DOC opened in text mode. */
export const TEXT_MODE_NOTE = "Text mode: pictures and character formatting (fonts, colours, emphasis) are not shown.";

const WRONG_FORMAT: Partial<Record<DocContainer, string>> = {
  rtf: "it is a Rich Text Format (RTF) file; save it as .docx in Word or LibreOffice, or open it as .rtf",
  html: "it is a web page (HTML); open it as an .html file",
  mhtml: "it is a single-file web page (MHTML); save it as .docx in Word or LibreOffice",
  wordml: "it is a Word 2003 XML document; save it as .docx in Word or LibreOffice",
};

/**
 * Loads a Word 97-2003 document: checks what the file really contains (decisions-v1 F02), parses the
 * binary format in pure JavaScript, renders its sections as page sheets and snapshots them. Sheets
 * come only from section starts and explicit page breaks; Word's automatic pagination is not
 * reproduced, so a sheet grows to hold everything up to the next break. A Word 2007+ package with a
 * .doc name is opened with the DOCX adapter.
 *
 * @throws DocError for encrypted, Word 6/95 or older, damaged or differently formatted files (RTF,
 *   HTML, MHTML, Word 2003 XML: code "wrong-format" with `format`); InputError for missing or
 *   oversized input; DocxError for a broken renamed .docx.
 */
export async function loadDoc(
  input: SourceInput,
  ctx: AdapterContext,
  options: DocAdapterOptions = {},
): Promise<DocLoadedSource> {
  const bytes = await readInputBytes(input, ctx, MAX_DOC_BYTES);
  ctx.signal?.throwIfAborted();
  const container = detectDocContainer(bytes);
  if (container === "zip") {
    const docx = await loadDocx({ ...input, bytes, url: undefined }, ctx, { snapshotHtml: options.snapshotHtml });
    docx.blueprint.source = { ...docx.blueprint.source, url: input.url };
    const notes = ["This .doc file is a Word 2007 or later document and was opened as .docx.", ...docx.notes];
    return { blueprint: docx.blueprint, notes, pages: docx.pages, view: "docx" };
  }
  const wrong = WRONG_FORMAT[container];
  if (wrong) throw new DocError("wrong-format", wrong, { format: container });
  if (container === "word2" || container === "word-dos") {
    const what = container === "word2" ? "Word for Windows 1.x/2.x" : "Word for DOS or Windows Write";
    throw new DocError("unsupported-version", `${what} file`);
  }
  const mode = options.mode ?? "text";
  const model = parseDoc(bytes, { pictures: mode === "rich" });
  ctx.signal?.throwIfAborted();
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Number.isFinite(ctx.width) ? ctx.width : 0)));
  const sandbox = createSandbox(ctx.document, width);
  try {
    sandbox.addCss(docCss(ctx.theme, width));
    const sheets = renderDoc(model, sandbox.root, width, mode);
    const notes = [...(mode === "text" ? [TEXT_MODE_NOTE] : []), ...model.warnings];
    const inline = Array.from(sandbox.root.querySelectorAll<HTMLElement>("[style*='font-family']"), (el) => {
      return `font-family: ${el.style.fontFamily};`;
    });
    const fonts = fontSubstitutionNote(ctx.document, primaryFamilies(inline.join("\n")));
    if (fonts) notes.push(fonts);
    const blueprint = await snapshotPaged({
      sandbox,
      pages: sheets,
      ctx,
      source: { type: "doc", name: input.name, url: input.url, title: documentTitle(model, input.name) },
      icon: documentIcon("DOC"),
      snapshotHtml: options.snapshotHtml,
    });
    return { blueprint, notes, pages: sheets.length, view: mode };
  } finally {
    sandbox.dispose();
  }
}

/** The first title or heading of the document, else the file name without extension. */
function documentTitle(model: DocModel, name: string | undefined): string | undefined {
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (block.kind !== "paragraph" || (!block.title && block.heading === 0)) continue;
      const text = block.runs
        .map((r) => (r.kind === "text" ? r.text : ""))
        .join("")
        .trim();
      if (text) return text.slice(0, 120);
    }
  }
  return name?.replace(/\.[^.]+$/, "") || undefined;
}

/** Creates a DOC adapter with custom options; {@link docAdapter} uses the defaults. */
export function createDocAdapter(options: DocAdapterOptions = {}): Adapter {
  return {
    id: "doc",
    label: "Word 97-2003 document",
    extensions: ["doc"],
    mime: ["application/msword"],
    load: (input, ctx) => loadDoc(input, ctx, options),
  };
}

/**
 * Adapter for legacy Word 97-2003 binary documents (.doc), pure JavaScript (no Word, no LibreOffice),
 * the same code path in the browser and the CLI. By default it shows the text: paragraphs, headings,
 * lists, tables, headers/footers, footnotes/endnotes and hyperlinks in the document's body font
 * (text mode); `createDocAdapter({ mode: "rich" })` adds character formatting and inline pictures.
 */
export const docAdapter: Adapter = createDocAdapter();

export default docAdapter;
