/**
 * @swarmloom/adapter-notebook: Jupyter notebooks (nbformat 4). Each code cell is framed, typed,
 * run and its outputs revealed; markdown cells are typed as rendered text.
 */

export { createNotebookAdapter, DEFAULT_MAX_BYTES, type NotebookAdapterOptions, notebookAdapter } from "./adapter";
export { highlightCode, resolveLanguage } from "./highlight";
export { base64Head, dataUrlImage, imageSize, type PixelSize } from "./images";
export { buildNotebookBlueprint, type NotebookLayoutOptions, notebookIcon } from "./layers";
export { type MarkdownHtmlOptions, markdownToHtml, parseMarkdown, soleHeading } from "./markdown";
export { createMeasurer, estimateHeight, type Measurer, type MeasureStyle } from "./measure";
export {
  type Cell,
  type CodeCell,
  type ErrorOutput,
  type HtmlOutput,
  type ImageData,
  type ImageMime,
  type ImageOutput,
  looksLikeNotebook,
  type MarkdownCell,
  type MarkdownOutput,
  type Notebook,
  NotebookError,
  type Output,
  type ParseOptions,
  parseNotebook,
  type RawCell,
  type StreamOutput,
  type TextOutput,
} from "./nbformat";
export {
  createNotebookPlugin,
  NOTEBOOK_PLUGIN,
  notebookPlugin,
  promptText,
  RUN_TASK,
  type RunData,
  readRunData,
} from "./plugin";
export { cleanStyle, htmlText, resolveAttachments, sanitizeHtml } from "./sanitize";
export { MONO_FONT, type NotebookPalette, notebookCss, notebookPalette, UI_FONT } from "./theme";
