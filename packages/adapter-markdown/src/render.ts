import {
  codeTheme,
  escapeAttr,
  escapeHtml,
  type Highlighted,
  languageForFence,
  lineToHtml,
} from "@swarmloom/adapter-code";
import type {
  Blockquote,
  Code,
  Definition,
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  Image,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Root,
  Table,
  Text,
} from "mdast";
import type { CalloutKind } from "./theme";

/** remark-math nodes (declared locally to avoid depending on mdast-util-math types). */
export interface MathNode {
  type: "math";
  value: string;
  meta?: string | null;
}
export interface InlineMathNode {
  type: "inlineMath";
  value: string;
}

/** Any node the renderer understands. */
export type MdNode = Nodes | MathNode | InlineMathNode;

/** Result of rendering one formula: KaTeX HTML or a parse error message. */
export type MathResult = { html: string } | { error: string };

export interface RenderInputs {
  scheme: "light" | "dark";
  /** Base for relative links and images. */
  baseUrl?: string;
  /** Pass raw HTML through (it is sanitized afterwards); false escapes it as text. */
  allowHtml: boolean;
  /** Language of the labels the renderer adds (callout titles). */
  locale?: string;
  /** `lang` attribute of the document (CJK glyph selection). */
  lang?: string;
  /** Highlighted code per fenced code node. */
  code: ReadonlyMap<Code, Highlighted>;
  /**
   * Highlights a fence that has no entry in {@link code}, for hosts with their own highlighter
   * (adapter-notebook uses its kernel languages and palette). Returns the inner HTML of `<code>`,
   * already escaped (it is sanitized with the rest), or undefined to show the fence as plain text.
   */
  renderCode?: (code: string, lang: string | null | undefined) => string | undefined;
  /** Rendered SVG per diagram code node (Mermaid). */
  diagrams: ReadonlyMap<Code, string>;
  /** Formula renderer; absent when math is disabled or failed to load. */
  math?: (tex: string, display: boolean) => MathResult;
  /** Allow `https:` images. Default true; false keeps only data:, blob: (and local file:) images. */
  remoteImages?: boolean;
  /** Maps a relative image path to a URL (files from a dropped folder or zip). */
  resolveAsset?: AssetResolver;
}

/**
 * Maps a relative path written in the document to a loadable URL, usually a blob: URL of a file
 * the user dropped together with the Markdown (folder or zip). The path is normalized by
 * {@link assetPath} first, so "./img/shot.png", "img/./shot.png" and "img/shot.png?v=2" all
 * arrive as "img/shot.png". Undefined means "not found"; the path is then resolved against the
 * base URL as usual.
 */
export type AssetResolver = (path: string) => string | undefined;

/** Which image sources a document may load. */
export interface ImagePolicy {
  /** Allow `https:` images. Default true. */
  remote?: boolean;
}

export interface HeadingInfo {
  depth: number;
  text: string;
  id: string;
}

export interface Rendered {
  /** Unsanitized HTML: `<article class="loom-doc">...</article>`. */
  html: string;
  /** Text of the first level-1 heading. */
  title?: string;
  headings: HeadingInfo[];
  warnings: string[];
  /** True when raw HTML from the source was passed through (it still needs sanitizing). */
  rawHtml: boolean;
}

const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const DATA_IMAGE = /^data:image\/(?:png|gif|jpeg|webp|avif|svg\+xml)[;,]/i;

const CALLOUTS: Record<string, Record<CalloutKind, string>> = {
  en: { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" },
  zh: { note: "说明", tip: "提示", important: "重要", warning: "警告", caution: "注意" },
  ja: { note: "注記", tip: "ヒント", important: "重要", warning: "警告", caution: "注意" },
};
const CALLOUT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 8.4 6.9 11l5-5.8" fill="none" stroke="#FFFFFF" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function schemeOf(url: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
}

function resolveRelative(url: string, base: string | undefined): string {
  if (!base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** A link target safe to keep, or undefined (javascript:, vbscript:, data:, ...). */
export function safeHref(url: string, base?: string): string | undefined {
  const v = url.trim();
  if (!v) return undefined;
  if (v.startsWith("#")) return v;
  const scheme = schemeOf(v);
  if (!scheme) return resolveRelative(v, base);
  return LINK_SCHEMES.has(scheme) ? v : undefined;
}

/** True for a path without a scheme ("img/a.png", "../a.png", "/a.png"), false for "#x" and "//host/a". */
export function isRelativeUrl(url: string): boolean {
  const v = url.trim();
  return v !== "" && !v.startsWith("#") && !v.startsWith("//") && schemeOf(v) === undefined;
}

/**
 * Normalizes a relative reference for an {@link AssetResolver}: percent-decoded, backslashes as
 * slashes, without the query, hash, empty and "." segments, with "dir/.." collapsed. Leading ".."
 * segments that leave the document folder are kept; a leading "/" is dropped (the dropped folder is
 * the root).
 */
export function assetPath(url: string): string {
  const bare = url.trim().replace(/[?#].*$/s, "");
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // Malformed escapes: keep the path as written.
  }
  const out: string[] = [];
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * An image source safe to load, or undefined. Allowed: raster/SVG data: URLs, blob: URLs,
 * `https:` (unless `policy.remote` is false) and `file:` when the document itself is a local file.
 * Plain `http:` is refused: it would be mixed content in the Studio and leak the reader's address.
 */
export function safeImageSrc(url: string, base?: string, policy: ImagePolicy = {}): string | undefined {
  const v = url.trim();
  if (!v) return undefined;
  const resolved = schemeOf(v) || v.startsWith("//") ? v : resolveRelative(v, base);
  const scheme = schemeOf(resolved.startsWith("//") ? `https:${resolved}` : resolved);
  if (!scheme) return resolved;
  if (scheme === "data") return DATA_IMAGE.test(resolved) ? resolved : undefined;
  if (scheme === "blob") return resolved;
  if (scheme === "https") return policy.remote === false ? undefined : resolved;
  if (scheme === "file") return base !== undefined && schemeOf(base) === "file" ? resolved : undefined;
  return undefined;
}

/**
 * Resolves an image URL of the document: the asset resolver first (relative paths only), then the
 * base URL and the image policy. Returns the URL to load, or a warning explaining why not.
 */
export function imageSource(
  url: string,
  opts: { baseUrl?: string; remoteImages?: boolean; resolveAsset?: AssetResolver },
): { src?: string; warning?: string } {
  const mapped = isRelativeUrl(url) ? opts.resolveAsset?.(assetPath(url)) : undefined;
  const remote = opts.remoteImages !== false;
  const src = safeImageSrc(mapped ?? url, opts.baseUrl, { remote });
  if (src) return { src };
  const shown = JSON.stringify(url.trim().slice(0, 80));
  const blockedRemote = !remote && safeImageSrc(mapped ?? url, opts.baseUrl) !== undefined;
  return {
    warning: blockedRemote ? `image removed: remote images are off ${shown}` : `image removed: unsafe URL ${shown}`,
  };
}

/** GitHub-style heading slug: lower case, punctuation removed, spaces to dashes. Keeps CJK. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** Plain text of a subtree (image alt text included). */
export function plainText(node: MdNode): string {
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if ("children" in node) return (node.children as MdNode[]).map(plainText).join("");
  return "";
}

function childrenOf(node: MdNode): MdNode[] {
  return "children" in node ? (node.children as MdNode[]) : [];
}

/** Detects the dominant CJK script for the `lang` attribute (affects glyph shapes). */
export function guessLang(text: string): string | undefined {
  const sample = text.slice(0, 20_000);
  if (/[぀-ヿ]/.test(sample)) return "ja";
  if (/[가-힣]/.test(sample)) return "ko";
  if (/[一-鿿]/.test(sample)) return "zh-CN";
  return undefined;
}

/** Turns mdast into themed, semantic HTML. Holds per-document state (slugs, footnotes). */
class HtmlRenderer {
  readonly warnings: string[] = [];
  readonly headings: HeadingInfo[] = [];
  private readonly slugs = new Map<string, number>();
  private readonly definitions = new Map<string, Definition>();
  private readonly footnoteDefs = new Map<string, FootnoteDefinition>();
  private readonly footnoteOrder: string[] = [];
  private readonly footnoteRefs = new Map<string, number>();
  private threadPlaced = false;
  private rawHtmlSeen = false;
  private title: string | undefined;

  constructor(private readonly opts: RenderInputs) {}

  render(root: Root): Rendered {
    this.collect(root);
    const body = this.blocks(root.children as MdNode[], false);
    const notes = this.footnotes();
    const lang = this.opts.lang ? ` lang="${escapeAttr(this.opts.lang)}"` : "";
    const html = `<article class="loom-doc" data-scheme="${this.opts.scheme}"${lang}><div class="loom-body">${body}${notes}</div></article>`;
    return { html, title: this.title, headings: this.headings, warnings: this.warnings, rawHtml: this.rawHtmlSeen };
  }

  private collect(node: MdNode): void {
    if (node.type === "definition" && !this.definitions.has(node.identifier))
      this.definitions.set(node.identifier, node);
    if (node.type === "footnoteDefinition" && !this.footnoteDefs.has(node.identifier)) {
      this.footnoteDefs.set(node.identifier, node);
    }
    for (const child of childrenOf(node)) this.collect(child);
  }

  private blocks(nodes: MdNode[], tight: boolean): string {
    let out = "";
    for (const node of nodes) out += this.block(node, tight);
    return out;
  }

  private block(node: MdNode, tight: boolean): string {
    switch (node.type) {
      case "paragraph":
        return this.paragraph(node, tight);
      case "heading":
        return this.heading(node);
      case "thematicBreak":
        return "<hr>";
      case "blockquote":
        return this.blockquote(node);
      case "list":
        return this.list(node);
      case "code":
        return this.code(node);
      case "math":
        return this.mathBlock(node.value);
      case "html":
        return this.rawHtml(node.value);
      case "table":
        return this.table(node);
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        return "";
      default:
        return "children" in node ? this.blocks(childrenOf(node), tight) : this.inline([node]);
    }
  }

  private inline(nodes: MdNode[]): string {
    let out = "";
    for (const node of nodes) out += this.phrasing(node);
    return out;
  }

  private phrasing(node: MdNode): string {
    switch (node.type) {
      case "text":
        return escapeHtml(node.value);
      case "emphasis":
        return `<em>${this.inline(node.children)}</em>`;
      case "strong":
        return `<strong>${this.inline(node.children)}</strong>`;
      case "delete":
        return `<del>${this.inline(node.children)}</del>`;
      case "inlineCode":
        return `<code>${escapeHtml(node.value)}</code>`;
      case "break":
        return "<br>";
      case "html":
        return this.rawHtml(node.value);
      case "link":
        return this.link(node.url, node.title, this.inline(node.children));
      case "linkReference": {
        const def = this.definitions.get(node.identifier);
        const content = this.inline(node.children);
        return def ? this.link(def.url, def.title, content) : `[${content}]`;
      }
      case "image":
        return this.image(node.url, node.alt, node.title);
      case "imageReference": {
        const def = this.definitions.get(node.identifier);
        return def ? this.image(def.url, node.alt, def.title) : escapeHtml(`![${node.alt ?? ""}]`);
      }
      case "footnoteReference":
        return this.footnoteRef(node);
      case "inlineMath":
        return this.mathInline(node.value);
      default:
        return "children" in node
          ? this.inline(childrenOf(node))
          : "value" in node
            ? escapeHtml(String(node.value))
            : "";
    }
  }

  private paragraph(node: Paragraph, tight: boolean): string {
    const figure = this.figure(node);
    if (figure) return figure;
    const content = this.inline(node.children);
    return tight ? content : `<p>${content}</p>`;
  }

  /** A paragraph holding only an image (optionally linked) becomes a captioned figure. */
  private figure(node: Paragraph): string | undefined {
    const kids = node.children.filter((c) => !(c.type === "text" && c.value.trim() === ""));
    if (kids.length !== 1) return undefined;
    const only = kids[0];
    const img: Image | undefined =
      only?.type === "image"
        ? only
        : only?.type === "link" && only.children.length === 1 && only.children[0]?.type === "image"
          ? only.children[0]
          : undefined;
    if (!img) return undefined;
    const caption = img.title ? `<figcaption>${escapeHtml(img.title)}</figcaption>` : "";
    return `<figure class="loom-figure">${this.image(img.url, img.alt, null)}${caption}</figure>`;
  }

  private heading(node: Heading): string {
    const text = plainText(node).trim();
    const id = this.uniqueSlug(text);
    this.headings.push({ depth: node.depth, text, id });
    if (node.depth === 1 && this.title === undefined) this.title = text;
    let html = `<h${node.depth} id="${escapeAttr(id)}">${this.inline(node.children)}</h${node.depth}>`;
    if (node.depth === 1 && !this.threadPlaced) {
      this.threadPlaced = true;
      html += '<div class="loom-thread" aria-hidden="true"></div>';
    }
    return html;
  }

  private uniqueSlug(text: string): string {
    const base = slugify(text) || "section";
    const seen = this.slugs.get(base) ?? 0;
    this.slugs.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  }

  private blockquote(node: Blockquote): string {
    const first = node.children[0];
    const lead = first?.type === "paragraph" ? first.children[0] : undefined;
    const match = lead?.type === "text" ? CALLOUT_RE.exec(lead.value) : null;
    if (!match || first?.type !== "paragraph" || lead?.type !== "text") {
      return `<blockquote>${this.blocks(node.children as MdNode[], false)}</blockquote>`;
    }
    const kind = (match[1] ?? "note").toLowerCase() as CalloutKind;
    const rest: Text = { ...lead, value: lead.value.slice(match[0].length) };
    const para: Paragraph = { ...first, children: [rest, ...first.children.slice(1)] };
    const hasText = plainText(para).trim() !== "";
    const children = [...(hasText ? [para] : []), ...node.children.slice(1)] as MdNode[];
    const labels = CALLOUTS[(this.opts.locale ?? "en").slice(0, 2).toLowerCase()] ?? CALLOUTS.en;
    const title = `<p class="loom-callout-title">${escapeHtml(labels?.[kind] ?? kind)}</p>`;
    return `<blockquote class="loom-callout loom-callout-${kind}">${title}${this.blocks(children, false)}</blockquote>`;
  }

  private list(node: List): string {
    const ordered = node.ordered === true;
    const start = node.start ?? 1;
    const tight = node.spread !== true && node.children.every((item) => item.spread !== true);
    let items = "";
    node.children.forEach((item, i) => {
      items += this.listItem(item, tight, ordered ? `${start + i}.` : undefined);
    });
    if (!ordered) return `<ul>${items}</ul>`;
    const digits = String(Math.abs(start + node.children.length - 1)).length;
    const width = `${(0.6 * (digits + 1)).toFixed(1)}em`;
    const startAttr = start !== 1 ? ` start="${start}"` : "";
    return `<ol${startAttr} style="--loom-num-w:${width}">${items}</ol>`;
  }

  private listItem(item: ListItem, tight: boolean, number: string | undefined): string {
    const children = item.children as MdNode[];
    if (typeof item.checked === "boolean") {
      const checked = item.checked ? "true" : "false";
      const box = `<span class="task-box" data-checked="${checked}" role="img" aria-label="${item.checked ? "done" : "to do"}">${item.checked ? CHECK_SVG : ""}</span>`;
      const [first, ...rest] = children;
      const label =
        first?.type === "paragraph"
          ? tight
            ? `<span class="task-label">${this.inline(first.children)}</span>`
            : `<p class="task-label">${this.inline(first.children)}</p>`
          : first
            ? this.block(first, tight)
            : "";
      return `<li class="task-item" data-checked="${checked}">${box}${label}${this.blocks(rest, tight)}</li>`;
    }
    const marker =
      number !== undefined
        ? `<span class="loom-num" aria-hidden="true">${number}</span>`
        : '<span class="loom-bullet" aria-hidden="true"></span>';
    return `<li>${marker}${this.blocks(children, tight)}</li>`;
  }

  private code(node: Code): string {
    const svg = this.opts.diagrams.get(node);
    if (svg) return `<figure class="loom-diagram" role="img" aria-label="Diagram">${svg}</figure>`;
    const lang = languageForFence(node.lang);
    const label = lang?.label ?? node.lang?.trim() ?? "";
    const highlighted = this.opts.code.get(node);
    const theme = codeTheme(this.opts.scheme);
    const body = highlighted
      ? highlighted.lines.map((l) => lineToHtml(l, theme)).join("\n")
      : (this.opts.renderCode?.(node.value, node.lang) ?? escapeHtml(node.value));
    const head = label ? `<div class="loom-code-head">${escapeHtml(label)}</div>` : "";
    const dataLang = lang ? ` data-lang="${lang.id}"` : "";
    return `<div class="loom-code"${dataLang}>${head}<pre><code>${body}</code></pre></div>`;
  }

  private mathBlock(tex: string): string {
    const result = this.opts.math?.(tex, true);
    if (result && "html" in result) {
      return `<div class="loom-math-block" role="math" aria-label="${escapeAttr(tex)}">${result.html}</div>`;
    }
    if (result) this.warnings.push(`math: ${result.error}`);
    return `<div class="loom-code loom-math-error"><pre><code>${escapeHtml(tex)}</code></pre></div>`;
  }

  private mathInline(tex: string): string {
    const result = this.opts.math?.(tex, false);
    if (result && "html" in result) {
      return `<span class="loom-math" role="math" aria-label="${escapeAttr(tex)}">${result.html}</span>`;
    }
    if (result) this.warnings.push(`math: ${result.error}`);
    return `<code class="loom-math-error">${escapeHtml(tex)}</code>`;
  }

  private rawHtml(value: string): string {
    if (!this.opts.allowHtml) return escapeHtml(value);
    this.rawHtmlSeen = true;
    return value;
  }

  private table(node: Table): string {
    const align = node.align ?? [];
    const [head, ...body] = node.children;
    const row = (cells: Table["children"][number]["children"], tag: "th" | "td") =>
      `<tr>${cells
        .map((cell, i) => {
          const a = align[i];
          const style = a ? ` style="text-align:${a}"` : "";
          return `<${tag}${style}>${this.inline(cell.children as MdNode[])}</${tag}>`;
        })
        .join("")}</tr>`;
    const thead = head ? `<thead>${row(head.children, "th")}</thead>` : "";
    const tbody = body.length ? `<tbody>${body.map((r) => row(r.children, "td")).join("")}</tbody>` : "";
    return `<table>${thead}${tbody}</table>`;
  }

  private link(url: string, title: string | null | undefined, content: string): string {
    const href = safeHref(url, this.opts.baseUrl);
    if (!href) {
      this.warnings.push(`link removed: unsafe URL ${JSON.stringify(url.slice(0, 80))}`);
      return content;
    }
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    return `<a href="${escapeAttr(href)}"${t}>${content}</a>`;
  }

  private image(url: string, alt: string | null | undefined, title: string | null | undefined): string {
    const { src, warning } = imageSource(url, this.opts);
    const altText = alt ?? "";
    if (!src) {
      if (warning) this.warnings.push(warning);
      return `<span class="loom-blocked" role="img" aria-label="${escapeAttr(altText)}">[${escapeHtml(altText || "image")}]</span>`;
    }
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(altText)}"${t} loading="eager" decoding="async" referrerpolicy="no-referrer">`;
  }

  private footnoteRef(node: FootnoteReference): string {
    const id = node.identifier;
    if (!this.footnoteDefs.has(id)) return escapeHtml(`[^${node.label ?? id}]`);
    let index = this.footnoteOrder.indexOf(id);
    if (index === -1) index = this.footnoteOrder.push(id) - 1;
    const count = (this.footnoteRefs.get(id) ?? 0) + 1;
    this.footnoteRefs.set(id, count);
    const slug = footnoteSlug(id);
    const refId = count === 1 ? `fnref-${slug}` : `fnref-${slug}-${count}`;
    return `<sup class="fn-ref"><a href="#fn-${slug}" id="${refId}">${index + 1}</a></sup>`;
  }

  /** Footnotes in first-reference order; notes referenced only from other notes are appended as found. */
  private footnotes(): string {
    if (this.footnoteOrder.length === 0) return "";
    let items = "";
    for (let i = 0; i < this.footnoteOrder.length; i++) {
      const id = this.footnoteOrder[i] as string;
      const def = this.footnoteDefs.get(id);
      if (!def) continue;
      const slug = footnoteSlug(id);
      const back = `<a href="#fnref-${slug}" class="fn-back" aria-label="Back to reference ${i + 1}">↩︎</a>`;
      let content = this.blocks(def.children as MdNode[], false);
      content = content.endsWith("</p>") ? `${content.slice(0, -4)}${back}</p>` : `${content}${back}`;
      items += `<li id="fn-${slug}"><span class="loom-num" aria-hidden="true">${i + 1}.</span>${content}</li>`;
    }
    const digits = String(this.footnoteOrder.length).length;
    const width = `${(0.6 * (digits + 1)).toFixed(1)}em`;
    return `<section class="footnotes" aria-label="Footnotes"><hr><ol style="--loom-num-w:${width}">${items}</ol></section>`;
  }
}

function footnoteSlug(id: string): string {
  return slugify(id).replace(/[^\w-]/g, (c) => `_${c.codePointAt(0)?.toString(16)}`) || "note";
}

/** Renders a parsed Markdown tree to HTML (unsanitized; see {@link RenderInputs.allowHtml}). */
export function renderMdast(root: Root, opts: RenderInputs): Rendered {
  return new HtmlRenderer(opts).render(root);
}
