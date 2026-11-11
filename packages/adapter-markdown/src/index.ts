/**
 * @swarmloom/adapter-markdown: Markdown (CommonMark + GFM + math) -> the Loom document theme ->
 * snapshot-dom -> Blueprint.
 *
 * The pure helpers (`markdownToHtml`, `parseMarkdown`, `renderMdast`, `loomThemeCss`) work in any
 * DOM environment and need no layout.
 */

export type { MarkdownAdapterOptions, MarkdownLoadContext } from "./adapter";
export { createMarkdownAdapter, markdownAdapter } from "./adapter";
export { registerFonts } from "./fonts";
export type { FontFaceSpec, MathAssets, MathEngine } from "./math/index";
export { createMathEngine, loadMath } from "./math/index";
export type { FrontMatter } from "./parse";
export { isDollarAmount, parseMarkdown, splitFrontMatter } from "./parse";
export type { DiagramRenderer, MarkdownHtml, MarkdownToHtmlOptions } from "./pipeline";
export { markdownToHtml } from "./pipeline";
export type { AssetResolver, HeadingInfo, ImagePolicy, MathResult, Rendered, RenderInputs } from "./render";
export { assetPath, imageSource, isRelativeUrl, renderMdast, safeHref, safeImageSrc, slugify } from "./render";
export { sanitizeDocument, sanitizeSvg } from "./sanitize";
export type { CalloutKind, LoomPalette } from "./theme";
export { LOOM_DARK, LOOM_LIGHT, loomPalette, loomThemeCss, MEASURE, TEXT_FONT } from "./theme";
