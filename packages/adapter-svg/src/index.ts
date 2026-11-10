/**
 * @swarmloom/adapter-svg: SVG documents rebuilt as pen-drawn paths, traced and filled shapes,
 * typed text and painted images.
 */
export { createSvgAdapter, type SvgAdapterOptions, svgAdapter, svgAdapter as default } from "./adapter";
export type { PenAnchor } from "./path/anchors";
export { extractAnchors } from "./path/anchors";
export { type ParsedPath, type PathSegment, parsePathData } from "./path/parse";
export { DEFS_TASK, SVG_PLUGIN, type SvgDefsData, svgPlugin } from "./plugin";
export { type SanitizeReport, sanitizeSvgTree } from "./sanitize";
