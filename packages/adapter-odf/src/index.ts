/**
 * @swarmloom/adapter-odf: OpenDocument text, spreadsheets and presentations (zipped or flat XML)
 * rebuilt as page sheets, grids and slides. The shared document kit (safe ZIP/XML, fonts, sheets)
 * is exported separately as `@swarmloom/adapter-odf/kit`.
 */
export { createOdfAdapter, type OdfAdapterOptions, odfAdapter, odfAdapter as default, sniffOdf } from "./adapter";
export { DocumentError, type DocumentErrorCode } from "./kit/errors";
export type { LoadedDocument } from "./kit/sheet";
export { type OdfKind, type OdfPackage, openOdf } from "./package";
export { OdfStyles } from "./styles";
