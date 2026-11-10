import {
  type LoadedText,
  loadSnapshotDom,
  readSource,
  type SnapshotDom,
  type TextAdapter,
} from "@swarmloom/adapter-code";
import type { AdapterContext, SourceInput } from "@swarmloom/core";
import { registerFonts } from "./fonts";
import type { MathEngine } from "./math/index";
import { type DiagramRenderer, markdownToHtml } from "./pipeline";
import type { AssetResolver } from "./render";
import { loomPalette } from "./theme";

/** Options of {@link createMarkdownAdapter}. */
export interface MarkdownAdapterOptions {
  /** Reject sources larger than this many bytes. Default 4 MiB. */
  maxBytes?: number;
  /** Render raw HTML in Markdown (always sanitized). Default true. */
  allowHtml?: boolean;
  /** Render math with KaTeX. Default true. */
  math?: boolean;
  /** Optional diagram renderer for ```mermaid fences (none is bundled). */
  renderDiagram?: DiagramRenderer;
  /** Base URL for relative links and images. Default: the input URL. */
  baseUrl?: string;
  /** Allow `https:` images, fetched without a referrer. Default true (a setting may turn it off). */
  remoteImages?: boolean;
  /** Maps relative image paths to URLs, e.g. blob: URLs of files dropped with the document (folder or zip). */
  resolveAsset?: AssetResolver;
  /** Math engine loader. Default: the bundled KaTeX, loaded only when the document has formulas. */
  loadMath?: () => Promise<MathEngine>;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshot?: SnapshotDom;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
/**
 * Page width bounds. The page is a reading surface: past 920 px it would only add empty margin
 * around the 720 px column, which shrinks the content once the stage fits it to the viewport.
 */
const MIN_WIDTH = 360;
const MAX_WIDTH = 920;

function checkContext(ctx: AdapterContext): void {
  if (!ctx || typeof ctx !== "object" || !ctx.document)
    throw new TypeError("markdown: AdapterContext with a document is required");
  if (!Number.isFinite(ctx.width) || ctx.width <= 0)
    throw new RangeError(`markdown: ctx.width must be positive, got ${ctx.width}`);
  if (ctx.theme !== "light" && ctx.theme !== "dark")
    throw new TypeError(`markdown: ctx.theme must be "light" or "dark"`);
}

/** Our own intro icon: an indigo tile with a page and a heading mark. */
function markdownIcon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#5B5BF7"/>' +
    '<path d="M19 20h26M19 30h20M19 38h26M19 46h14" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="46" cy="46" r="5" fill="#FF6B5B"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Creates the Markdown adapter: CommonMark + GFM (+ math) -> sanitized themed HTML -> laid out
 * in a hidden sandbox by snapshot-dom -> Blueprint. Headings, paragraphs, list items, code,
 * tables and quotes are real elements, so the swarm builds them with matching choreography.
 */
export function createMarkdownAdapter(options: MarkdownAdapterOptions = {}): TextAdapter {
  return {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    mime: ["text/markdown", "text/x-markdown"],
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedText> {
      checkContext(ctx);
      ctx.signal?.throwIfAborted();
      const src = await readSource(input, {
        adapter: "markdown",
        maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
        signal: ctx.signal,
      });
      const baseUrl = options.baseUrl ?? src.url;
      const rendered = await markdownToHtml(src.text, {
        scheme: ctx.theme,
        baseUrl,
        allowHtml: options.allowHtml,
        math: options.math,
        locale: ctx.locale,
        renderDiagram: options.renderDiagram,
        remoteImages: options.remoteImages,
        resolveAsset: options.resolveAsset,
        loadMath: options.loadMath,
        window: ctx.document.defaultView ?? undefined,
      });
      ctx.signal?.throwIfAborted();
      const warnings = [...rendered.warnings, ...(await registerFonts(ctx.document, rendered.fonts))];

      const snap = options.snapshot ?? (await loadSnapshotDom());
      const palette = loomPalette(ctx.theme);
      const title = rendered.title ?? src.name;
      const source = {
        type: "markdown",
        ...(src.name ? { name: src.name } : {}),
        ...(title ? { title } : {}),
        ...(src.url ? { url: src.url } : {}),
      };
      const blueprint = await snap.snapshotHtml(rendered.html, {
        width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ctx.width))),
        css: rendered.css,
        document: ctx.document,
        baseUrl,
        background: palette.page,
        scheme: ctx.theme,
        icon: markdownIcon(),
        source,
        maxLayers: ctx.maxLayers,
        signal: ctx.signal,
      });
      blueprint.source = { ...blueprint.source, ...source };
      blueprint.scheme ??= ctx.theme;
      return { blueprint, warnings };
    },
  };
}

/** Markdown adapter with default options (id "markdown"). */
export const markdownAdapter: TextAdapter = createMarkdownAdapter();
