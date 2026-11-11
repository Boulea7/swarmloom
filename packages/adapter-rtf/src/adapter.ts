import {
  AssetUrls,
  type BudgetLimits,
  ContentBudget,
  checkContext,
  DEFAULT_BUDGET,
  type DocumentAdapter,
  documentIcon,
  FontReport,
  type LoadedDocument,
  loaded,
  readBytes,
  type SnapshotHtml,
  snapshotSheets,
} from "@swarmloom/adapter-odf/kit";
import type { AdapterContext, SourceInput } from "@swarmloom/core";
import type { RtfDocument } from "./model";
import { parseRtf, type RtfParseOptions, sniffRtf } from "./parser";
import { renderRtf } from "./render";

/** Options of {@link createRtfAdapter}. */
export interface RtfAdapterOptions {
  /** Reject inputs larger than this. Default 50 MiB. */
  maxBytes?: number;
  /** Long-input budget (S10). Default {@link DEFAULT_BUDGET}. */
  budget?: Partial<BudgetLimits>;
  /** Parser limits. */
  parse?: RtfParseOptions;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshotHtml?: SnapshotHtml;
}

const ID = "rtf";
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Quality notes for content the parser skipped or could not show. */
export function rtfNotes(doc: RtfDocument, missingImages = 0): string[] {
  const s = doc.stats;
  const notes: string[] = [];
  if (s.unsupportedPictures > 0)
    notes.push(`${s.unsupportedPictures} picture(s) in EMF, WMF or other metafile formats are shown as placeholders.`);
  if (s.droppedPictures > 0)
    notes.push(`${s.droppedPictures} picture(s) were over the size limits and are shown as placeholders.`);
  if (missingImages > 0) notes.push(`${missingImages} picture(s) could not be shown.`);
  if (s.headers > 0) notes.push("Headers and footers are not shown.");
  if (s.footnotes > 0) notes.push("Footnotes and comments are not shown.");
  if (s.nestedTables > 0) notes.push("Nested tables were flattened into their outer cells.");
  return notes;
}

/**
 * Creates the RTF adapter: the document is parsed by our own tokenizer ({@link parseRtf}),
 * rendered as page sheets and laid out by snapshot-dom. The same pipeline serves RTF content that
 * arrives with a .doc extension (adapter-doc can call `load` directly).
 */
export function createRtfAdapter(options: RtfAdapterOptions = {}): DocumentAdapter {
  return {
    id: ID,
    label: "Rich Text (RTF)",
    extensions: ["rtf"],
    mime: ["application/rtf", "text/rtf"],
    sniff: sniffRtf,
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedDocument> {
      checkContext(ctx, ID);
      const src = await readBytes(input, {
        format: ID,
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
      });
      const win = ctx.document.defaultView;
      if (!win) throw new TypeError(`${ID}: ctx.document needs a window`);
      const doc = parseRtf(src.bytes, options.parse);
      ctx.signal?.throwIfAborted();
      const assets = new AssetUrls(win.URL, win.Blob);
      try {
        const fonts = new FontReport();
        const budget = new ContentBudget({ ...DEFAULT_BUDGET, ...options.budget });
        const render = renderRtf(doc, { fonts, assets, budget });
        const title = doc.title ?? src.name;
        const blueprint = await snapshotSheets(render, {
          ctx,
          icon: documentIcon("RTF", "#64748B"),
          source: {
            type: ID,
            ...(src.name ? { name: src.name } : {}),
            ...(title ? { title } : {}),
            ...(src.url ? { url: src.url } : {}),
          },
          ...(options.snapshotHtml ? { snapshotHtml: options.snapshotHtml } : {}),
          ...(budget.dropped > 0
            ? { truncated: { reason: "Long document: only the first pages were woven.", dropped: budget.dropped } }
            : {}),
        });
        return loaded(blueprint, [fonts.note(), ...rtfNotes(doc, render.stats.missingImages)], () =>
          assets.revokeAll(),
        );
      } catch (error) {
        assets.revokeAll();
        throw error;
      }
    },
  };
}

/** RTF adapter with default options (id "rtf"). */
export const rtfAdapter: DocumentAdapter = createRtfAdapter();
