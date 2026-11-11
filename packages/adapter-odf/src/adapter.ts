import type { AdapterContext, SourceInput } from "@swarmloom/core";
import { renderText } from "./document";
import type { FlowStats } from "./flow";
import { AssetUrls } from "./kit/assets";
import { type BudgetLimits, ContentBudget, DEFAULT_BUDGET } from "./kit/budget";
import { FontReport } from "./kit/fonts";
import { documentIcon } from "./kit/icons";
import {
  checkContext,
  type DocumentAdapter,
  type LoadedDocument,
  loaded,
  type SheetRender,
  snapshotSheets,
} from "./kit/sheet";
import type { SnapshotHtml } from "./kit/snapshot";
import { readBytes } from "./kit/source";
import { firstZipEntry } from "./kit/zip";
import { type OdfKind, openOdf } from "./package";
import { MAX_SLIDES, renderSlides } from "./slides";
import { renderSpreadsheet } from "./spreadsheet";
import { OdfStyles } from "./styles";

/** Options of {@link createOdfAdapter}. */
export interface OdfAdapterOptions {
  /** Reject inputs larger than this. Default 100 MiB. */
  maxBytes?: number;
  /** Long-input budget (S10). Default {@link DEFAULT_BUDGET}. */
  budget?: Partial<BudgetLimits>;
  /** Most slides of a presentation. Default 20. */
  maxSlides?: number;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshotHtml?: SnapshotHtml;
}

const ID = "odf";
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

const ICON: Record<OdfKind, [string, string]> = {
  text: ["ODT", "#3BA7F5"],
  spreadsheet: ["ODS", "#22C55E"],
  presentation: ["ODP", "#FB923C"],
};

const ODF_MIME =
  /^application\/vnd\.oasis\.opendocument\.(?:text|spreadsheet|presentation|graphics)(?:-template|-master)?$/;
const FLAT_HEAD = /<office:document\b[^>]*office:mimetype="application\/vnd\.oasis\.opendocument\./;

/**
 * True for ODF packages (the first entry is a stored `mimetype` naming an ODF text, spreadsheet,
 * presentation or drawing type) and flat ODF XML (`office:document` with such a mimetype).
 */
export function sniffOdf(head: Uint8Array): boolean {
  const first = firstZipEntry(head);
  if (first)
    return first.name === "mimetype" && !!first.stored && ODF_MIME.test(new TextDecoder().decode(first.stored).trim());
  return FLAT_HEAD.test(new TextDecoder().decode(head.subarray(0, 4096)));
}

function kindNotes(kind: OdfKind, stats: FlowStats & { approximated?: number }, missingImages: number): string[] {
  const notes: string[] = [];
  if (kind === "spreadsheet") notes.push("Cells show their saved values; formulas are not recalculated.");
  if (stats.objects > 0)
    notes.push(`${stats.objects} embedded object(s) (charts, formulas, OLE) are shown as placeholders.`);
  if (missingImages > 0)
    notes.push(`${missingImages} image(s) could not be shown (missing, linked externally or not a supported type).`);
  if (stats.tableCuts > 0) notes.push(`${stats.tableCuts} table(s) were cut to fit the size limits.`);
  if (stats.approximated) notes.push(`${stats.approximated} shape fill(s) or outline(s) were simplified.`);
  return notes;
}

/**
 * Creates the OpenDocument adapter: ODT text documents as page sheets (paragraphs, headings, lists,
 * tables, images, frames, headers and footers, footnotes, styles from styles.xml and automatic
 * styles), ODS spreadsheets as grids (saved values, column widths, row heights, bold and fills,
 * merged cells) and ODP presentations or ODG drawings as slides of positioned frames and shapes.
 * Flat XML files (.fodt/.fods/.fodp/.fodg) are read too. Everything is laid out by snapshot-dom.
 */
export function createOdfAdapter(options: OdfAdapterOptions = {}): DocumentAdapter {
  return {
    id: ID,
    label: "OpenDocument",
    extensions: ["odt", "ott", "fodt", "ods", "ots", "fods", "odp", "otp", "fodp", "odg", "fodg"],
    mime: [
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.text-template",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.spreadsheet-template",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.oasis.opendocument.presentation-template",
      "application/vnd.oasis.opendocument.graphics",
    ],
    sniff: sniffOdf,
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedDocument> {
      checkContext(ctx, ID);
      const src = await readBytes(input, {
        format: ID,
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
      });
      const win = ctx.document.defaultView;
      if (!win) throw new TypeError(`${ID}: ctx.document needs a window`);
      const assets = new AssetUrls(win.URL, win.Blob);
      try {
        const pkg = openOdf(src.bytes, win, assets);
        const styles = new OdfStyles(pkg.content, pkg.styles);
        const fonts = new FontReport();
        const budget = new ContentBudget({ ...DEFAULT_BUDGET, ...options.budget });
        let render: SheetRender & { stats: FlowStats & { approximated?: number } };
        let what: string;
        if (pkg.kind === "text") {
          render = renderText(pkg, styles, fonts, budget);
          what = "Long document: only the first pages were woven.";
        } else if (pkg.kind === "spreadsheet") {
          render = renderSpreadsheet(pkg, styles, fonts, budget);
          what = "Large spreadsheet: only the first sheets and rows were woven.";
        } else {
          render = renderSlides(pkg, styles, fonts, budget, options.maxSlides ?? MAX_SLIDES);
          what = "Long presentation: only the first slides were woven.";
        }
        if (render.sheets.length === 0) render = emptySheet(render);
        ctx.signal?.throwIfAborted();
        const [label, color] = ICON[pkg.kind];
        const title = pkg.title ?? src.name;
        const blueprint = await snapshotSheets(render, {
          ctx,
          icon: documentIcon(label, color),
          source: {
            type: ID,
            ...(src.name ? { name: src.name } : {}),
            ...(title ? { title } : {}),
            ...(src.url ? { url: src.url } : {}),
          },
          ...(options.snapshotHtml ? { snapshotHtml: options.snapshotHtml } : {}),
          ...(budget.dropped > 0 ? { truncated: { reason: what, dropped: budget.dropped } } : {}),
        });
        return loaded(blueprint, [fonts.note(), ...kindNotes(pkg.kind, render.stats, pkg.missingImages)], () =>
          assets.revokeAll(),
        );
      } catch (error) {
        assets.revokeAll();
        throw error;
      }
    },
  };
}

function emptySheet<T extends SheetRender>(render: T): T {
  const spec = { w: 794, h: 1123 };
  return {
    ...render,
    sheets: [spec],
    html: `<section class="sl-sheet" style="width:794px;min-height:1123px;"></section>`,
  };
}

/** OpenDocument adapter with default options (id "odf"). */
export const odfAdapter: DocumentAdapter = createOdfAdapter();
