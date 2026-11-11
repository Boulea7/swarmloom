/**
 * Markdown cells to HTML through the shared renderer of @swarmloom/adapter-markdown
 * (`parseMarkdown` + `renderMdast`: CommonMark, GFM, footnotes, callouts and `$` math), so both
 * adapters read Markdown the same way. Fences go through the notebook's own highlighter, and
 * formulas keep their TeX source (no KaTeX in notebooks). The result is NOT sanitized; pass it
 * through `sanitizeHtml`.
 */

import { type MathResult, parseMarkdown, renderMdast } from "@swarmloom/adapter-markdown";
import { escapeHtml } from "@swarmloom/adapter-terminal/ansi";

export { parseMarkdown };

export interface MarkdownHtmlOptions {
  /** Highlights a fenced code block; returns HTML. Default: escaped text. */
  highlight?: (code: string, lang: string | null | undefined) => string;
  /** Colour scheme written on the rendered article. Default "light". */
  scheme?: "light" | "dark";
  /** Language of added labels (callout titles). */
  locale?: string;
}

const NO_CODE = new Map();

/** Formulas are shown as written, delimiters included, the way the cell source reads. */
function texSource(tex: string, display: boolean): MathResult {
  return { html: escapeHtml(display ? `$$${tex}$$` : `$${tex}$`) };
}

/** Markdown to unsanitized HTML (`<article class="loom-doc">`), styled by the notebook sheet. */
export function markdownToHtml(markdown: string, opts: MarkdownHtmlOptions = {}): string {
  return renderMdast(parseMarkdown(markdown), {
    scheme: opts.scheme ?? "light",
    allowHtml: true,
    locale: opts.locale,
    code: NO_CODE,
    diagrams: NO_CODE,
    renderCode: opts.highlight,
    math: texSource,
  }).html;
}

/** True when the markdown is a single heading (such cells grow while typed, like headings do). */
export function soleHeading(markdown: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const root = parseMarkdown(markdown);
  const only = root.children.length === 1 ? root.children[0] : undefined;
  return only?.type === "heading" ? only.depth : null;
}
