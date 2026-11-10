/**
 * Shared building blocks of the SwarmLoom document adapters (ODF, EPUB, RTF, OFD): safe ZIP and
 * XML reading, the F01 font fallback table, CSS value checks, blob URLs, the long-input budget and
 * the sheet snapshot step. Imported as `@swarmloom/adapter-odf/kit`.
 */
export { AssetUrls, decodeBase64, type ImageMime, imageSize, sniffImage } from "./assets";
export { type BudgetLimits, ContentBudget, DEFAULT_BUDGET } from "./budget";
export { cssColor, keyword, lengthPx, MM, percent, px, rgb, styleText } from "./css";
export { DocumentError, type DocumentErrorCode } from "./errors";
export { cleanFamily, type FontChoice, FontReport, fontStack, type GenericFamily } from "./fonts";
export { attrs, cleanText, escapeHtml } from "./html";
export { documentIcon } from "./icons";
export {
  checkContext,
  DESK_PAD,
  type DocumentAdapter,
  deskCss,
  type LoadedDocument,
  loaded,
  markSheets,
  openSheet,
  type SheetRender,
  type SheetSpec,
  type SnapshotSheetsOptions,
  snapshotSheets,
} from "./sheet";
export { loadSnapshotHtml, type SnapshotHtml, type SnapshotHtmlOptions } from "./snapshot";
export { type ReadOptions, readBytes, type SourceBytes } from "./source";
export { attr, descendants, is, kid, kids, type ParseXmlOptions, parseXml, XML_LIMITS, type XmlLimits } from "./xml";
export { firstZipEntry, resolvePath, ZIP_LIMITS, ZipArchive, type ZipLimits, zipHeadNames } from "./zip";
