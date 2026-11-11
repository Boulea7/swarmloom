/**
 * Markdown cells to HTML: unified + remark-parse + remark-gfm (the versions adapter-markdown uses)
 * and a small mdast serializer. The result is NOT sanitized; pass it through `sanitizeHtml`.
 *
 * Dedupe note: adapter-markdown has its own `markdownToHtml` pipeline (themes, KaTeX, fonts) that
 * is not on main yet. Once it is exported, notebook markdown cells should use it.
 */

import { escapeHtml } from "@swarmloom/adapter-terminal/ansi";
import type { Definition, ListItem, Nodes, Root, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface MarkdownHtmlOptions {
  /** Highlights a fenced code block; returns HTML. Default: escaped text. */
  highlight?: (code: string, lang: string | null | undefined) => string;
}

/** Deepest nesting rendered; deeper content is flattened to text. */
const MAX_DEPTH = 64;

const processor = unified().use(remarkParse).use(remarkGfm).freeze();

/** Parses markdown (CommonMark + GFM) into mdast. */
export function parseMarkdown(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}

/** Attribute-safe link target: http(s), mailto and in-page fragments; anything else is dropped. */
function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(?:https?:|mailto:|#)/i.test(u) ? u : null;
}

function collectDefinitions(node: Nodes, out: Map<string, Definition>, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (node.type === "definition") {
    const id = node.identifier.toLowerCase();
    if (!out.has(id)) out.set(id, node);
  }
  if ("children" in node) for (const c of node.children) collectDefinitions(c as Nodes, out, depth + 1);
}

function plainText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plainText).join("");
  return "";
}

class Writer {
  readonly defs = new Map<string, Definition>();
  constructor(readonly opts: MarkdownHtmlOptions) {}

  all(nodes: readonly Nodes[], depth: number, tight = false): string {
    return nodes.map((n) => this.node(n, depth, tight)).join("");
  }

  link(href: string, title: string | null | undefined, inner: string): string {
    const safe = safeHref(href);
    if (!safe) return inner;
    const t = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(safe)}"${t}>${inner}</a>`;
  }

  image(src: string, alt: string, title: string | null | undefined): string {
    const t = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${t}>`;
  }

  table(node: Table, depth: number): string {
    const rows = node.children.map((row, r) => {
      const tag = r === 0 ? "th" : "td";
      const cells = row.children.map((cell, c) => {
        const align = node.align?.[c];
        const style = align ? ` style="text-align:${align}"` : "";
        return `<${tag}${style}>${this.all(cell.children, depth + 1)}</${tag}>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    });
    const [head, ...body] = rows;
    return `<table><thead>${head ?? ""}</thead>${body.length ? `<tbody>${body.join("")}</tbody>` : ""}</table>`;
  }

  listItem(node: ListItem, depth: number, tight: boolean): string {
    const task = typeof node.checked === "boolean";
    const mark = task ? `<span class="slnb-check">${node.checked ? "☑" : "☐"}</span>` : "";
    return `<li${task ? ' class="slnb-task"' : ""}>${mark}${this.all(node.children, depth + 1, tight)}</li>`;
  }

  node(n: Nodes, depth: number, tight = false): string {
    if (depth > MAX_DEPTH) return escapeHtml(plainText(n));
    switch (n.type) {
      case "root":
        return this.all(n.children, depth + 1);
      case "paragraph": {
        const inner = this.all(n.children, depth + 1);
        return tight ? inner : `<p>${inner}</p>`;
      }
      case "heading":
        return `<h${n.depth}>${this.all(n.children, depth + 1)}</h${n.depth}>`;
      case "text":
        return escapeHtml(n.value);
      case "emphasis":
        return `<em>${this.all(n.children, depth + 1)}</em>`;
      case "strong":
        return `<strong>${this.all(n.children, depth + 1)}</strong>`;
      case "delete":
        return `<del>${this.all(n.children, depth + 1)}</del>`;
      case "inlineCode":
        return `<code>${escapeHtml(n.value)}</code>`;
      case "break":
        return "<br>";
      case "thematicBreak":
        return "<hr>";
      case "blockquote":
        return `<blockquote>${this.all(n.children, depth + 1)}</blockquote>`;
      case "code": {
        const body = this.opts.highlight ? this.opts.highlight(n.value, n.lang) : escapeHtml(n.value);
        return `<pre><code>${body}</code></pre>`;
      }
      case "html":
        // Raw HTML is passed on; the sanitizer decides what survives.
        return n.value;
      case "list": {
        const tag = n.ordered ? "ol" : "ul";
        const start =
          n.ordered && n.start !== null && n.start !== undefined && n.start !== 1 ? ` start="${n.start}"` : "";
        const items = n.children.map((li) => this.listItem(li, depth + 1, !n.spread));
        return `<${tag}${start}>${items.join("")}</${tag}>`;
      }
      case "listItem":
        return this.listItem(n, depth, tight);
      case "link":
        return this.link(n.url, n.title, this.all(n.children, depth + 1));
      case "image":
        return this.image(n.url, n.alt ?? "", n.title);
      case "linkReference": {
        const def = this.defs.get(n.identifier.toLowerCase());
        const inner = this.all(n.children, depth + 1);
        return def ? this.link(def.url, def.title, inner) : escapeHtml(`[${plainText(n)}]`);
      }
      case "imageReference": {
        const def = this.defs.get(n.identifier.toLowerCase());
        return def ? this.image(def.url, n.alt ?? "", def.title) : escapeHtml(n.alt ?? "");
      }
      case "table":
        return this.table(n, depth);
      case "footnoteReference":
        return `<sup>[${escapeHtml(n.label ?? n.identifier)}]</sup>`;
      case "footnoteDefinition":
        return `<p><sup>[${escapeHtml(n.label ?? n.identifier)}]</sup> ${this.all(n.children, depth + 1, true)}</p>`;
      case "definition":
        return "";
      default:
        return "children" in n ? this.all(n.children as Nodes[], depth + 1) : escapeHtml(plainText(n));
    }
  }
}

/** Markdown to unsanitized HTML. */
export function markdownToHtml(markdown: string, opts: MarkdownHtmlOptions = {}): string {
  const root = parseMarkdown(markdown);
  const writer = new Writer(opts);
  collectDefinitions(root, writer.defs);
  return writer.node(root, 0);
}

/** True when the markdown is a single heading (such cells grow while typed, like headings do). */
export function soleHeading(markdown: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const root = parseMarkdown(markdown);
  const only = root.children.length === 1 ? root.children[0] : undefined;
  return only?.type === "heading" ? only.depth : null;
}
