/**
 * @swarmloom/adapter-office: presentations (`slidesAdapter`, PPTX) and spreadsheets
 * (`sheetAdapter`, XLSX/XLSM/ODS/CSV/TSV).
 *
 * The subpath entries `@swarmloom/adapter-office/slides` and `@swarmloom/adapter-office/sheet`
 * load one adapter without the other's code.
 */

export { OfficeFormatError } from "./shared/errors";
export type { OfficeAdapter, OfficeLoadedSource } from "./shared/loaded";
export {
  type CsvParseOptions,
  type CsvParseResult,
  createSheetAdapter,
  parseCsv,
  type SheetAdapterOptions,
  sheetAdapter,
  sniffDelimiter,
} from "./sheet";
export { createSlidesAdapter, type SlidesAdapterOptions, slidesAdapter } from "./slides";
