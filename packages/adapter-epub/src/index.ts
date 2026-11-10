/**
 * @swarmloom/adapter-epub: EPUB 2/3 e-books as page sheets for SwarmLoom.
 */

export { DocumentError, type DocumentErrorCode, type LoadedDocument } from "@swarmloom/adapter-odf/kit";
export {
  createEpubAdapter,
  type EpubAdapterOptions,
  epubAdapter,
  epubAdapter as default,
  outlineNote,
  sniffEpub,
} from "./adapter";
export { type Book, type ManifestItem, readBook, type SpineItem, type TocEntry } from "./book";
export { type FontFaceSpec, scopeSelector, scopeStylesheet, splitSelectors } from "./css";
