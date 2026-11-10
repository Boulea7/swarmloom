/**
 * @swarmloom/adapter-ofd: OFD (GB/T 33190) documents as page sheets for SwarmLoom.
 */

export { DocumentError, type DocumentErrorCode, type LoadedDocument } from "@swarmloom/adapter-odf/kit";
export { createOfdAdapter, type OfdAdapterOptions, ofdAdapter, ofdAdapter as default, sniffOfd } from "./adapter";
export { type MmBox, type OfdFont, type OfdPackage, type OfdPageRef, openOfd, parseBox } from "./package";
export { abbreviatedToSvg } from "./path";
export {
  type OfdRender,
  type OfdRenderOptions,
  type OfdStats,
  ofdColor,
  PX_PER_MM,
  parseDeltas,
  parseMatrix,
  renderOfd,
} from "./render";
