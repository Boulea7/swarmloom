/**
 * @swarmloom/adapter-code: source code -> an editor panel whose lines the swarm types.
 *
 * Also the shared syntax layer of the text adapters: language detection, lazily loaded
 * highlight.js grammars, the original Loom Day / Loom Night colour themes, and source reading
 * helpers. The Markdown adapter highlights its code blocks with the same functions.
 */

export type { CodeAdapterOptions } from "./adapter";
export { codeAdapter, createCodeAdapter } from "./adapter";
export type { IndentGuide } from "./editor/indent";
export { indentGuides } from "./editor/indent";
export type { EditorLayoutOptions, EditorMetrics, MeasureText } from "./editor/layout";
export { estimateTextWidth, layoutEditor, MONO_FONT, UI_FONT } from "./editor/layout";
export { canvasMeasurer, monoCharRatio } from "./editor/measure";
export type { DetectInput } from "./syntax/detect";
export { detectLanguage, languageForName, sniffLanguage } from "./syntax/detect";
export type { Highlighted, HighlightOptions, Token, TokenLine } from "./syntax/highlight";
export {
  expandTabs,
  highlight,
  lineText,
  lineToHtml,
  parseHighlightHtml,
  plainLines,
  splitLines,
} from "./syntax/highlight";
export type { LanguageSpec } from "./syntax/languages";
export {
  LANGUAGES,
  languageById,
  languageForExtension,
  languageForFence,
  languageForMime,
  PLAIN_TEXT,
} from "./syntax/languages";
export type { CodeTheme, TokenStyle } from "./syntax/themes";
export { codeTheme, LOOM_DAY, LOOM_NIGHT, resolveTokenStyle, tokenCss } from "./syntax/themes";
export { escapeAttr, escapeHtml } from "./util/escape";
export type { SnapshotCommonOptions, SnapshotDom, SnapshotHtmlOptions } from "./util/snapshot";
export { loadSnapshotDom } from "./util/snapshot";
export type { LoadedText, ReadSourceOptions, SourceText, TextAdapter } from "./util/source";
export { charsetOf, decodeText, formatBytes, nameFromUrl, readSource } from "./util/source";
export { columnWidth } from "./util/width";
