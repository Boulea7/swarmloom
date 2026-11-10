import { block, blocks, type FlowContext, type FlowStats } from "./flow";
import type { ContentBudget } from "./kit/budget";
import { px, styleText } from "./kit/css";
import type { FontReport } from "./kit/fonts";
import { openSheet, type SheetRender, type SheetSpec } from "./kit/sheet";
import { a, isOdf } from "./ns";
import { bodyOf, type OdfPackage } from "./package";
import { StyleClasses, textCss } from "./style-css";
import type { MasterPage, OdfStyles } from "./styles";

/** Result of rendering a text document. */
export interface TextRender extends SheetRender {
  stats: FlowStats;
  pages: number;
}

interface Page {
  master: MasterPage | undefined;
  body: string[];
  notes: string[];
}

/** Element resets and fixed parts of the text document style sheet. */
function baseCss(root: string, defaultText: string): string {
  const r = `.${root}`;
  return [
    `${r}{${defaultText}line-height:1.2;overflow-wrap:break-word;}`,
    `${r} p,${r} h1,${r} h2,${r} h3,${r} h4,${r} h5,${r} h6{margin:0;font-size:inherit;font-weight:inherit;}`,
    `${r} h1{font-size:1.75em;font-weight:700}${r} h2{font-size:1.45em;font-weight:700}${r} h3{font-size:1.2em;font-weight:700}`,
    `${r} h4,${r} h5,${r} h6{font-weight:700}`,
    `${r} ul,${r} ol{margin:0;}`,
    `${r} .odf-tab{white-space:pre;tab-size:4;}`,
    `${r} .odf-table{border-collapse:collapse;table-layout:fixed;max-width:100%;}`,
    `${r} .odf-cell{vertical-align:top;padding:2px 4px;}`,
    `${r} .odf-frame{max-width:100%;}`,
    `${r} .odf-img{display:block;width:100%;height:100%;object-fit:fill;}`,
    `${r} .odf-object{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;background:#F1F1F5;color:#6B6B7B;font:12px sans-serif;}`,
    `${r} .odf-noteref{font-size:.7em;line-height:0;}`,
    `${r} .odf-notes{margin-top:12px;padding-top:4px;border-top:.75pt solid #000;font-size:.85em;}`,
    `${r} .odf-link{color:#1B4FD8;text-decoration:underline;}`,
    `${r} .odf-footer{position:absolute;}`,
  ].join("");
}

function breaksBefore(el: Element, styles: OdfStyles): { page: boolean; master?: string } {
  const family = isOdf(el, "table", "table") ? "table" : "paragraph";
  const name = a(el, family === "table" ? "table:style-name" : "text:style-name");
  const style = styles.resolve(family, name);
  const props = family === "table" ? style?.props.table : style?.props.paragraph;
  const master = style?.masterPage;
  return master ? { page: true, master } : { page: props?.get("fo:break-before") === "page" };
}

function breaksAfter(el: Element, styles: OdfStyles): boolean {
  const family = isOdf(el, "table", "table") ? "table" : "paragraph";
  const style = styles.resolve(family, a(el, family === "table" ? "table:style-name" : "text:style-name"));
  return (family === "table" ? style?.props.table : style?.props.paragraph)?.get("fo:break-after") === "page";
}

/**
 * Splits the body into pages at the page breaks the document records: LibreOffice's
 * `text:soft-page-break` (where its own layout broke pages), explicit breaks and master page
 * changes. Without such marks the document is one long page.
 */
function paginate(body: Element, fc: FlowContext, styles: OdfStyles): { pages: Page[]; left: number } {
  const pages: Page[] = [];
  let current: Page = { master: styles.master(), body: [], notes: [] };
  const flush = (master: MasterPage | undefined) => {
    if (current.body.length > 0) pages.push(current);
    current = { master: master ?? current.master, body: [], notes: [] };
  };
  const items = Array.from(body.children);
  let i = 0;
  for (; i < items.length && !fc.budget.exhausted; i++) {
    const el = items[i] as Element;
    if (isOdf(el, "text", "soft-page-break")) {
      flush(undefined);
      continue;
    }
    const before = breaksBefore(el, styles);
    if (before.page) flush(before.master ? styles.master(before.master) : undefined);
    fc.notes = current.notes;
    fc.page = pages.length + 1;
    const html = block(el, fc);
    if (html) current.body.push(html);
    if (breaksAfter(el, styles)) flush(undefined);
  }
  if (current.body.length > 0) pages.push(current);
  const left = items
    .slice(i)
    .filter((el) => !isOdf(el, "text", "soft-page-break") && el.localName !== "sequence-decls").length;
  return { pages, left };
}

function headerFooter(el: Element | undefined, fc: FlowContext, page: number): string {
  if (!el) return "";
  const saved = { scope: fc.scope, page: fc.page };
  fc.scope = "styles";
  fc.page = page;
  const html = blocks(el, fc).join("");
  fc.scope = saved.scope;
  fc.page = saved.page;
  return html;
}

/** Renders an ODT body as page sheets. */
export function renderText(pkg: OdfPackage, styles: OdfStyles, fonts: FontReport, budget: ContentBudget): TextRender {
  const root = "odf";
  const classes = new StyleClasses(styles, fonts, root);
  const stats: FlowStats = { objects: 0, tableCuts: 0 };
  const fc: FlowContext = { pkg, styles, classes, budget, stats, scope: "content", notes: [], hoisted: [], page: 1 };
  const { pages, left } = paginate(bodyOf(pkg), fc, styles);
  budget.skip(left);
  fc.pages = pages.length;
  const sheets: SheetSpec[] = [];
  let html = "";
  pages.forEach((page, index) => {
    const layout = page.master?.layout ?? styles.defaultLayout();
    const spec: SheetSpec = { w: layout.width, h: layout.height };
    sheets.push(spec);
    const m = layout.margin;
    const pad = styleText({
      padding: `${px(m.top)} ${px(m.right)} ${px(m.bottom)} ${px(m.left)}`,
      ...(layout.background ? { background: layout.background } : {}),
    });
    const header = headerFooter(page.master?.header, fc, index + 1);
    const footer = headerFooter(page.master?.footer, fc, index + 1);
    html += openSheet(spec, { className: root, label: `Page ${index + 1}`, style: pad });
    if (header) html += `<header class="odf-header">${header}</header>`;
    html += page.body.join("");
    if (page.notes.length > 0) html += `<div class="odf-notes">${page.notes.join("")}</div>`;
    if (footer) {
      const place = styleText({ left: px(m.left), right: px(m.right), bottom: px(Math.max(8, m.bottom / 2)) });
      html += `<footer class="odf-footer" style="${place}">${footer}</footer>`;
    }
    html += "</section>";
  });
  const defaultText = styleText(textCss(styles.defaultProps("paragraph").text, styles, fonts));
  return {
    html,
    css: baseCss(root, defaultText) + classes.css(),
    sheets,
    role: "page",
    stats,
    pages: pages.length,
  };
}
