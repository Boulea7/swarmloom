/**
 * Shared building blocks for paged document adapters (DOCX, DOC): input reading, font fallbacks,
 * sanitizing, an isolated layout sandbox and the snapshot step that turns sheets into page layers.
 *
 * @packageDocumentation
 */
export {
  fontStack,
  fontSubstitutionNote,
  type GenericFamily,
  missingFonts,
  primaryFamilies,
  rewriteFontFamilies,
  substituteFor,
  withFontFallbacks,
} from "./fonts";
export { documentIcon } from "./icon";
export { InputError, type InputErrorCode, readInputBytes } from "./input";
export { counterPairs, MARKER_CLASS, MARKER_CSS, MARKER_DONE_CLASS, materializeMarkers, parseContent } from "./markers";
export { alphabetic, chineseCounting, cjkDecimal, formatCounter, roman, wordLetters } from "./numbering";
export { markPages, measurePages } from "./pages";
export { createSandbox, reparseContent, type Sandbox, waitForAssets } from "./sandbox";
export { sanitizeCss, sanitizeTree } from "./sanitize";
export {
  defaultSnapshotHtml,
  type SnapshotHtmlFn,
  type SnapshotHtmlOptions,
  type SnapshotPagedOptions,
  snapshotPaged,
} from "./snapshot";
export { mapSymbolText } from "./symbols";
export { availableSheetWidth, DESK, deskCss, deskPadding, PAGE_GAP, pageSheetStyle } from "./theme";
