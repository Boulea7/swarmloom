import { expandTabs, type Highlighted, highlight, languageForFence } from "@swarmloom/adapter-code";
import type { Code, Root } from "mdast";
import { type FontFaceSpec, loadMath, type MathEngine } from "./math/index";
import { parseMarkdown, splitFrontMatter } from "./parse";
import { type AssetResolver, guessLang, type HeadingInfo, imageSource, type MdNode, renderMdast } from "./render";
import { sanitizeDocument, sanitizeSvg } from "./sanitize";
import { loomThemeCss } from "./theme";

/**
 * Renders a diagram fence (```mermaid) to SVG. SwarmLoom does not bundle a diagram engine; hosts
 * that ship one (and accept its licence and size) pass this hook. Returning or throwing falls
 * back to showing the fence as a code block.
 */
export type DiagramRenderer = (source: string, info: { lang: string; scheme: "light" | "dark" }) => Promise<string>;

export interface MarkdownToHtmlOptions {
  scheme?: "light" | "dark";
  /** Base for relative links and images. */
  baseUrl?: string;
  /** Render raw HTML blocks (sanitized). Default true; false shows them as text. */
  allowHtml?: boolean;
  /** Render `$...$` and `$$...$$` with KaTeX (loaded only when formulas exist). Default true. */
  math?: boolean;
  /**
   * Loads the math engine when a formula is found. Default: the bundled KaTeX and its fonts
   * ({@link loadMath}). Hosts with their own asset pipeline (or tests) pass {@link createMathEngine}.
   */
  loadMath?: () => Promise<MathEngine>;
  /** Allow `https:` images (loaded without a referrer). Default true; false keeps only data:, blob: and local files. */
  remoteImages?: boolean;
  /** Maps relative image paths to URLs, e.g. blob: URLs of files dropped together with the document. */
  resolveAsset?: AssetResolver;
  /** Locale for added labels (callout titles). */
  locale?: string;
  /** `lang` of the document; detected from CJK script when omitted. */
  lang?: string;
  /** Renderer for diagram fences. Without it they show as code. */
  renderDiagram?: DiagramRenderer;
  /** Fence languages handed to `renderDiagram`. Default ["mermaid"]. */
  diagramLanguages?: readonly string[];
  /**
   * Window whose DOM DOMPurify uses. Default globalThis.window. Must be a standards-conformant DOM
   * (a browser, or jsdom); emulations where DOMPurify misbehaves are detected and rejected.
   */
  window?: Window;
}

export interface MarkdownHtml {
  /** Sanitized `<article class="loom-doc">` markup. */
  html: string;
  /** Theme CSS plus KaTeX CSS (with embedded fonts) when the document has math. */
  css: string;
  /** Fonts the CSS declares; register them in the layout document before measuring. */
  fonts: FontFaceSpec[];
  /** Front matter title, else the first level-1 heading. */
  title?: string;
  headings: HeadingInfo[];
  /** Recoverable problems: unsafe URLs removed, formulas that failed, diagram fallbacks. */
  warnings: string[];
}

interface Scan {
  code: Code[];
  hasMath: boolean;
}

function scan(root: Root): Scan {
  const out: Scan = { code: [], hasMath: false };
  const walk = (node: MdNode) => {
    if (node.type === "code") out.code.push(node);
    else if (node.type === "math" || node.type === "inlineMath") out.hasMath = true;
    if ("children" in node) for (const child of node.children as MdNode[]) walk(child);
  };
  walk(root);
  return out;
}

function fenceName(node: Code): string {
  return (node.lang ?? "").trim().toLowerCase();
}

async function highlightBlocks(blocks: Code[], diagrams: Set<Code>): Promise<Map<Code, Highlighted>> {
  const out = new Map<Code, Highlighted>();
  await Promise.all(
    blocks.map(async (node) => {
      if (diagrams.has(node)) return;
      const lang = languageForFence(node.lang);
      if (!lang?.grammar) return;
      const code = node.value
        .split("\n")
        .map((l) => expandTabs(l))
        .join("\n");
      out.set(node, await highlight(code, lang));
    }),
  );
  return out;
}

async function renderDiagrams(
  blocks: Code[],
  opts: MarkdownToHtmlOptions,
  scheme: "light" | "dark",
  warnings: string[],
): Promise<Map<Code, string>> {
  const out = new Map<Code, string>();
  const render = opts.renderDiagram;
  if (!render) return out;
  await Promise.all(
    blocks.map(async (node) => {
      try {
        const svg = await render(node.value, { lang: fenceName(node), scheme });
        if (typeof svg === "string" && /<svg[\s>]/i.test(svg)) out.set(node, svg);
        else warnings.push(`diagram: renderer returned no SVG for a ${fenceName(node)} block`);
      } catch (error) {
        warnings.push(`diagram: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return out;
}

/**
 * Final pass over the sanitized markup: splices the separately sanitized diagram SVGs into their
 * placeholders and applies the image policy to images written as raw HTML (`<img src>` in a
 * README), which the Markdown builder never saw: relative paths are resolved, `srcset` is dropped
 * so the capture does not depend on the device pixel ratio, and disallowed sources are removed.
 */
function finalize(
  html: string,
  diagrams: string[],
  win: Window,
  opts: MarkdownToHtmlOptions,
  warnings: string[],
): string {
  if (diagrams.length === 0 && !/<(?:img|source)\b/i.test(html)) return html;
  const tpl = win.document.createElement("template");
  tpl.innerHTML = html;
  for (const el of Array.from(tpl.content.querySelectorAll<HTMLElement>("figure.loom-diagram[data-diagram]"))) {
    const svg = diagrams[Number(el.dataset.diagram)];
    el.removeAttribute("data-diagram");
    if (svg) el.innerHTML = sanitizeSvg(svg, win);
  }
  for (const el of Array.from(tpl.content.querySelectorAll("source"))) el.remove();
  for (const img of Array.from(tpl.content.querySelectorAll("img"))) {
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.setAttribute("referrerpolicy", "no-referrer");
    const raw = img.getAttribute("src") ?? "";
    const { src, warning } = imageSource(raw, opts);
    if (src) {
      if (src !== raw) img.setAttribute("src", src);
      continue;
    }
    // Already reported when the Markdown builder emitted the image itself.
    if (warning && !warnings.includes(warning)) warnings.push(warning);
    const alt = img.getAttribute("alt") ?? "";
    const blocked = win.document.createElement("span");
    blocked.className = "loom-blocked";
    blocked.setAttribute("role", "img");
    blocked.setAttribute("aria-label", alt);
    blocked.textContent = `[${alt || "image"}]`;
    img.replaceWith(blocked);
  }
  return tpl.innerHTML;
}

/**
 * Markdown -> sanitized, themed HTML and CSS. Loads code grammars, KaTeX and its fonts only when
 * the document needs them. Sanitizing needs a conformant DOM (a browser, or jsdom in Node).
 */
export async function markdownToHtml(markdown: string, opts: MarkdownToHtmlOptions = {}): Promise<MarkdownHtml> {
  const scheme = opts.scheme ?? "light";
  const front = splitFrontMatter(markdown);
  const root = parseMarkdown(front.body);
  const { code, hasMath } = scan(root);
  const warnings: string[] = [];

  const diagramLangs = new Set((opts.diagramLanguages ?? ["mermaid"]).map((l) => l.toLowerCase()));
  const diagramBlocks = opts.renderDiagram ? code.filter((c) => diagramLangs.has(fenceName(c))) : [];
  let math: MathEngine | undefined;
  const [highlighted, diagramSvgs] = await Promise.all([
    highlightBlocks(code, new Set(diagramBlocks)),
    renderDiagrams(diagramBlocks, opts, scheme, warnings),
    hasMath && opts.math !== false
      ? (opts.loadMath ?? loadMath)().then(
          (engine) => {
            math = engine;
          },
          (error: unknown) => {
            warnings.push(
              `math: KaTeX could not be loaded (${error instanceof Error ? error.message : String(error)})`,
            );
          },
        )
      : undefined,
  ]);
  for (const h of highlighted.values()) if (h.warning) warnings.push(`code: ${h.warning}`);

  // Diagrams are rendered as numbered placeholders, sanitized on their own and spliced back in.
  const diagramList: string[] = [];
  const placeholders = new Map<Code, string>();
  for (const [node, svg] of diagramSvgs) {
    placeholders.set(node, `__diagram_${diagramList.length}__`);
    diagramList.push(svg);
  }
  const engine = math as MathEngine | undefined;
  const rendered = renderMdast(root, {
    scheme,
    baseUrl: opts.baseUrl,
    allowHtml: opts.allowHtml !== false,
    locale: opts.locale,
    lang: opts.lang ?? guessLang(front.body),
    code: highlighted,
    diagrams: placeholders,
    math: engine ? (tex, display) => engine.render(tex, display) : undefined,
    remoteImages: opts.remoteImages,
    resolveAsset: opts.resolveAsset,
  });
  let html = rendered.html.replace(
    /<figure class="loom-diagram" role="img" aria-label="Diagram">__diagram_(\d+)__<\/figure>/g,
    '<figure class="loom-diagram" role="img" aria-label="Diagram" data-diagram="$1"></figure>',
  );
  // Everything is sanitized, not only raw HTML: the builder escapes text and checks URLs, and
  // DOMPurify is the second, independent line of defence the product spec requires.
  const win = opts.window ?? (globalThis as { window?: Window }).window;
  if (!win?.document) throw new Error("markdown: a DOM window is required to sanitize HTML");
  const late: string[] = [...rendered.warnings];
  html = finalize(sanitizeDocument(html, win), diagramList, win, opts, late);

  let css = loomThemeCss(scheme);
  let fonts: FontFaceSpec[] = [];
  if (engine) {
    const assets = await engine.assets(html);
    css += assets.css;
    fonts = assets.fonts;
    if (assets.warning) warnings.push(assets.warning);
  }
  return {
    html,
    css,
    fonts,
    title: front.title ?? rendered.title,
    headings: rendered.headings,
    warnings: [...warnings, ...late],
  };
}
