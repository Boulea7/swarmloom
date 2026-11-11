/**
 * @swarmloom/adapter-svg: SVG documents rebuilt as pen-drawn paths, traced and filled shapes,
 * typed text and painted images; SMIL animation replays once the drawing is woven.
 */
export {
  createSvgAdapter,
  type SvgAdapterOptions,
  type SvgLoadContext,
  svgAdapter,
  svgAdapter as default,
} from "./adapter";
export type { PenAnchor } from "./path/anchors";
export { extractAnchors } from "./path/anchors";
export { type ParsedPath, type PathSegment, parsePathData } from "./path/parse";
export { createSvgPlugin, DEFS_TASK, SVG_PLUGIN, type SvgDefsData, svgPlugin } from "./plugin";
export { type SanitizeReport, sanitizeSvgTree } from "./sanitize";
export { SMIL_TASK, type SvgSmilData } from "./smil";
export { collectSmilTimeline, MAX_TIMELINE_MS, TIMELINE_BAND, TIMELINE_PLUGIN, type TimelineData } from "./timeline";
