import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Result of splitting YAML front matter off a Markdown source. */
export interface FrontMatter {
  /** Markdown body without the front matter block. */
  body: string;
  /** `title:` value when present. */
  title?: string;
}

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const YAML_KEY = /^[A-Za-z_][\w-]*\s*:/;

/**
 * Removes a leading YAML front matter block (common in docs sites). Only blocks whose first
 * non-empty line looks like `key: value` are treated as front matter, so a document that starts
 * with a thematic break is left alone.
 */
export function splitFrontMatter(source: string): FrontMatter {
  const text = source.replace(/^﻿/, "");
  const m = FRONT_MATTER.exec(text);
  if (!m) return { body: text };
  const yaml = m[1] ?? "";
  const first = yaml.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (!YAML_KEY.test(first)) return { body: text };
  const titleLine = /^title\s*:\s*(.+?)\s*$/m.exec(yaml)?.[1];
  const title = titleLine?.replace(/^(["'])(.*)\1$/, "$2").trim();
  return { body: text.slice(m[0].length), ...(title ? { title } : {}) };
}

let processor: ReturnType<typeof createProcessor> | undefined;

function createProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).freeze();
}

/**
 * Parses CommonMark + GFM (tables, task lists, strikethrough, autolinks, footnotes) + `$` math into
 * mdast. Single-dollar spans that do not look like TeX are kept as text (see
 * {@link isDollarAmount}), so prose such as "$5 and $6" is not turned into a formula.
 */
export function parseMarkdown(markdown: string): Root {
  processor ??= createProcessor();
  const root = processor.parse(markdown);
  keepDollarAmounts(root, markdown);
  return root;
}

interface Positioned {
  type: string;
  value?: string;
  children?: Positioned[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/**
 * Pandoc's rule for single-dollar math: the opening `$` is followed by a non-space, the closing
 * `$` is preceded by a non-space and not followed by a digit. `source` is the whole span,
 * delimiters included; `next` is the character after it.
 */
export function isDollarAmount(source: string, next: string): boolean {
  if (!/^\$[^$]/.test(source) || !/[^$]\$$/.test(source)) return false;
  const body = source.slice(1, -1);
  return /^\s/.test(body) || /\s$/.test(body) || /^[0-9]$/.test(next);
}

function keepDollarAmounts(node: Positioned, markdown: string): void {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i] as Positioned;
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (child.type === "inlineMath" && start !== undefined && end !== undefined) {
      const source = markdown.slice(start, end);
      if (isDollarAmount(source, markdown.charAt(end)))
        kids[i] = { type: "text", value: source, position: child.position };
      continue;
    }
    keepDollarAmounts(child, markdown);
  }
}
