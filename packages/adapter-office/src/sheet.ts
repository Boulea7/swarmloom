import type { AdapterContext, Blueprint, SourceInput } from "@swarmloom/core";
import { OfficeFormatError } from "./shared/errors";
import { SHEET_ICON } from "./shared/icons";
import { displayName, extensionOf, isCfb, readBytes } from "./shared/input";
import type { OfficeAdapter, OfficeLoadedSource } from "./shared/loaded";
import { isOpenDocument, isZip, ZipArchive } from "./shared/zip";
import { decodeText } from "./sheet/csv";
import { delimitedSheet } from "./sheet/delimited";
import { DEFAULT_SHEET_LIMITS, type SheetLimits, type WorkbookModel } from "./sheet/model";
import { type SheetNoteSource, sheetNotes } from "./sheet/notes";
import { readOds } from "./sheet/ods";
import { renderSheets } from "./sheet/render";
import { readXlsx } from "./sheet/xlsx";

export { OfficeFormatError } from "./shared/errors";
export type { OfficeAdapter, OfficeLoadedSource } from "./shared/loaded";
export { type CsvParseOptions, type CsvParseResult, parseCsv, sniffDelimiter } from "./sheet/csv";

/** Options of {@link createSheetAdapter}. */
export interface SheetAdapterOptions {
  /** Rows kept per sheet. Default 200. */
  maxRows?: number;
  /** Columns kept per sheet. Default 30. */
  maxCols?: number;
  /** Visible sheets rendered, stacked vertically. Default 3. */
  maxSheets?: number;
}

const DEFAULT_MAX_LAYERS = 6000;

const MIME_TSV = "text/tab-separated-values";

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

interface ReadResult {
  wb: WorkbookModel;
  source: SheetNoteSource;
}

async function readWorkbook(input: SourceInput, limits: SheetLimits, signal?: AbortSignal): Promise<ReadResult> {
  const bytes = await readBytes(input, signal);
  if (isCfb(bytes)) {
    throw new OfficeFormatError("Excel 97-2003 (.xls) files are not supported yet. Save the workbook as .xlsx or CSV.");
  }
  if (isZip(bytes)) {
    const zip = ZipArchive.open(bytes);
    if (isOpenDocument(zip, "spreadsheet")) return { wb: readOds(zip, limits, signal), source: { zip } };
    if (zip.has("xl/workbook.xml") || zip.has("_rels/.rels")) {
      return { wb: await readXlsx(zip, limits, signal), source: { zip } };
    }
    throw new OfficeFormatError("This ZIP file is not a spreadsheet");
  }
  const ext = extensionOf(input);
  if (ext === "xlsx" || ext === "xlsm" || ext === "ods" || ext === "xls") {
    throw new OfficeFormatError(`This file is not a valid .${ext} workbook`);
  }
  const text = input.text ?? decodeText(bytes);
  const tab = ext === "tsv" || ext === "tab" || input.type?.split(";")[0]?.trim() === MIME_TSV;
  const name = displayName(input, "data.csv").replace(/\.[^.]+$/, "") || "Sheet1";
  return { wb: { sheets: [delimitedSheet(text, name, limits, tab ? "\t" : undefined)], droppedSheets: 0 }, source: {} };
}

function truncation(wb: WorkbookModel, droppedCells: number, droppedSheets: number): Blueprint["truncated"] {
  const reasons: string[] = [];
  let dropped = droppedCells;
  for (const sheet of wb.sheets) {
    dropped += sheet.droppedCells;
    if (sheet.usedRows > sheet.rows || sheet.usedCols > sheet.cols) {
      reasons.push(
        `"${sheet.name}": showing ${sheet.rows} of ${sheet.usedRows} rows and ${sheet.cols} of ${sheet.usedCols} columns`,
      );
    }
  }
  const sheetsLeft = wb.droppedSheets + droppedSheets;
  if (sheetsLeft > 0) reasons.push(`${sheetsLeft} more sheet${sheetsLeft === 1 ? "" : "s"} not shown`);
  if (droppedCells > 0 && reasons.length === 0) reasons.push("The sheet has more cells than the layer limit");
  if (dropped === 0 && sheetsLeft === 0) return undefined;
  return { reason: reasons.join("; ") || "Some cells are not shown", dropped: dropped + sheetsLeft };
}

/**
 * Creates the spreadsheet adapter (id `sheet`): XLSX/XLSM, ODS, CSV and TSV.
 *
 * Each visible sheet is drawn as a page with a sheet tab, column-letter and row-number bars,
 * grid lines (path layers built first), cell fills (boxes) and cell text typed row by row
 * (numbers right-aligned, header row detected). Formulas are never evaluated: cached results
 * are shown. Rows/columns beyond the limits are dropped and reported in `Blueprint.truncated`;
 * formulas without a saved result, drawings and font substitutions are listed in
 * {@link OfficeLoadedSource.notes}.
 */
export function createSheetAdapter(options: SheetAdapterOptions = {}): OfficeAdapter {
  const limits: SheetLimits = {
    maxRows: clampLimit(options.maxRows, DEFAULT_SHEET_LIMITS.maxRows, 5000),
    maxCols: clampLimit(options.maxCols, DEFAULT_SHEET_LIMITS.maxCols, 200),
    maxSheets: clampLimit(options.maxSheets, DEFAULT_SHEET_LIMITS.maxSheets, 50),
  };
  return {
    id: "sheet",
    label: "Spreadsheet",
    // Legacy .xls is rejected, so not listed; its MIME type stays because Windows browsers give it to .csv files.
    extensions: ["xlsx", "xlsm", "ods", "csv", "tsv"],
    mime: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.spreadsheet",
      "text/csv",
      MIME_TSV,
    ],
    async load(input: SourceInput, ctx: AdapterContext): Promise<OfficeLoadedSource> {
      const { wb, source } = await readWorkbook(input, limits, ctx.signal);
      const rendered = renderSheets(wb.sheets, {
        width: Math.max(320, ctx.width),
        maxLayers: Math.max(64, ctx.maxLayers ?? DEFAULT_MAX_LAYERS),
      });
      const name = displayName(input, "spreadsheet");
      const blueprint: Blueprint = {
        version: 1,
        source: { type: "sheet", name, title: name, url: input.url },
        size: { w: Math.max(320, ctx.width), h: rendered.height },
        background: ctx.theme === "dark" ? "#16171d" : "#eef0f4",
        // Sheets are white pages with dark text in either theme.
        scheme: "light",
        icon: SHEET_ICON,
        layers: rendered.layers,
      };
      const truncated = truncation(wb, rendered.droppedCells, rendered.droppedSheets);
      if (truncated) blueprint.truncated = truncated;
      const notes = sheetNotes(wb, source, ctx.document);
      return notes.length > 0 ? { blueprint, notes } : { blueprint };
    },
  };
}

/** Spreadsheet adapter with default limits (200 rows x 30 columns, 3 sheets). */
export const sheetAdapter: OfficeAdapter = createSheetAdapter();
