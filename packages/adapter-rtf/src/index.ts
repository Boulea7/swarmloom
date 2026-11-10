/**
 * @swarmloom/adapter-rtf: Rich Text Format documents as page sheets for SwarmLoom, with an exported
 * parser for other adapters (RTF content inside .doc files).
 */

export { DocumentError, type DocumentErrorCode, type LoadedDocument } from "@swarmloom/adapter-odf/kit";
export { createRtfAdapter, type RtfAdapterOptions, rtfAdapter, rtfAdapter as default, rtfNotes } from "./adapter";
export { charsetCodepage, codepageLabel, decodeCodepage } from "./codepage";
export type {
  RtfBlock,
  RtfCell,
  RtfCharStyle,
  RtfDocument,
  RtfFont,
  RtfParagraph,
  RtfRow,
  RtfRun,
  RtfStats,
  RtfTable,
} from "./model";
export { parseRtf, type RtfParseOptions, rtfStart, sniffRtf } from "./parser";
export { type RtfRender, type RtfRenderOptions, renderRtf } from "./render";
