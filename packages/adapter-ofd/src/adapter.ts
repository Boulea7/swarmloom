import {
  AssetUrls,
  type BudgetLimits,
  ContentBudget,
  checkContext,
  DEFAULT_BUDGET,
  type DocumentAdapter,
  documentIcon,
  FontReport,
  firstZipEntry,
  type LoadedDocument,
  loaded,
  readBytes,
  type SnapshotHtml,
  snapshotSheets,
  ZipArchive,
  zipHeadNames,
} from "@swarmloom/adapter-odf/kit";
import type { AdapterContext, SourceInput } from "@swarmloom/core";
import { type OfdPackage, openOfd } from "./package";
import { type OfdStats, renderOfd } from "./render";

/** Options of {@link createOfdAdapter}. */
export interface OfdAdapterOptions {
  /** Reject inputs larger than this. Default 100 MiB. */
  maxBytes?: number;
  /** Long-input budget (S10). Default {@link DEFAULT_BUDGET}. */
  budget?: Partial<BudgetLimits>;
  /** Most pages rendered. Default 10. */
  maxPages?: number;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshotHtml?: SnapshotHtml;
}

const ID = "ofd";
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 10;

/** True for ZIP packages whose entries include a root `OFD.xml`. */
export function sniffOfd(head: Uint8Array): boolean {
  const first = firstZipEntry(head);
  if (!first) return false;
  return first.name === "OFD.xml" || zipHeadNames(head).includes("OFD.xml");
}

function notes(pkg: OfdPackage, stats: OfdStats): string[] {
  const out: string[] = [];
  if (pkg.signed) out.push("The document is digitally signed; signatures are neither verified nor drawn.");
  if (pkg.annotated) out.push("Annotations are not shown.");
  if (stats.embeddedFonts > 0) out.push(`${stats.embeddedFonts} embedded font(s) were replaced by fallback fonts.`);
  if (stats.composite > 0) out.push(`${stats.composite} composite object(s) are not drawn.`);
  if (stats.missingImages > 0)
    out.push(`${stats.missingImages} image(s) could not be shown (missing or not a supported type).`);
  if (stats.objectsCut > 0)
    out.push(`${stats.objectsCut} page(s) had more objects than the limit; the rest were left out.`);
  return out;
}

/**
 * Creates the OFD adapter (GB/T 33190, the Chinese fixed-layout format): OFD.xml -> Document.xml
 * -> Pages/Page_N/Content.xml. Text objects (TextCode with DeltaX/DeltaY), path objects
 * (AbbreviatedData) and image objects (MultiMedia resources) become absolutely positioned HTML and
 * SVG on one sheet per page; fonts follow the F01 fallback table (SimSun, KaiTi, SimHei -> Noto).
 */
export function createOfdAdapter(options: OfdAdapterOptions = {}): DocumentAdapter {
  return {
    id: ID,
    label: "OFD document",
    extensions: ["ofd"],
    mime: ["application/ofd"],
    sniff: sniffOfd,
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedDocument> {
      checkContext(ctx, ID);
      const src = await readBytes(input, {
        format: ID,
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
      });
      const win = ctx.document.defaultView;
      if (!win) throw new TypeError(`${ID}: ctx.document needs a window`);
      const pkg = openOfd(ZipArchive.open(src.bytes, ID), win);
      const assets = new AssetUrls(win.URL, win.Blob);
      try {
        const fonts = new FontReport();
        const budget = new ContentBudget({ ...DEFAULT_BUDGET, ...options.budget });
        const render = renderOfd(pkg, { win, fonts, assets, budget, maxPages: options.maxPages ?? DEFAULT_MAX_PAGES });
        ctx.signal?.throwIfAborted();
        const title = pkg.title ?? src.name;
        const blueprint = await snapshotSheets(render, {
          ctx,
          icon: documentIcon("OFD", "#EF4444"),
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
        return loaded(blueprint, [fonts.note(), ...notes(pkg, render.stats)], () => assets.revokeAll());
      } catch (error) {
        assets.revokeAll();
        throw error;
      }
    },
  };
}

/** OFD adapter with default options (id "ofd"). */
export const ofdAdapter: DocumentAdapter = createOfdAdapter();
