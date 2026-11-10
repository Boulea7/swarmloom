import { availableSheetWidth, mapSymbolText } from "@swarmloom/adapter-docx/paged";
import type { CharProps, DocBlock, DocModel, DocNote, DocParagraph, DocRun, DocTable, DocTextRun } from "../model";
import { defaultCharProps } from "../parser/props";
import { DESK_CLASS, PAGE_CLASS } from "./css";
import { type PageContent, paginate } from "./paginate";
import { charCss, charCssDiff, FontResolver, paraCss, styleText } from "./style";
import { halfPoints, px, twipsToPx } from "./units";

const SAFE_HREF = /^(?:https?:|mailto:)/i;
/** Smallest side margin kept when a sheet is narrowed to fit a small screen, px. */
const MIN_SIDE_MARGIN = 12;

/**
 * "text": the document's text and structure (paragraph layout, headings, lists, tables, headers,
 * footers, notes) in one body font, without pictures or character formatting. "rich": also fonts,
 * sizes, colours, emphasis and inline pictures, as far as the parser recovered them.
 */
export type DocRenderMode = "text" | "rich";

/** Class added to sheets rendered in text mode. */
export const TEXT_MODE_CLASS = "swl-doc-text";

interface RenderState {
  doc: Document;
  text: boolean;
  fonts: FontResolver;
  model: DocModel;
  /** Footnote indexes referenced on the sheet being rendered, in order. */
  notes: number[];
}

/**
 * Renders a parsed DOC into `root` as a desk of page sheets and returns the sheet elements.
 * Sheets are narrowed (with proportional side margins) when the document page is wider than `width` allows.
 */
export function renderDoc(
  model: DocModel,
  root: HTMLElement,
  width: number,
  mode: DocRenderMode = "rich",
): HTMLElement[] {
  const doc = root.ownerDocument;
  const state: RenderState = { doc, text: mode === "text", fonts: new FontResolver(model.fonts), model, notes: [] };
  const desk = el(doc, "div", DESK_CLASS);
  const pages = paginate(model.sections);
  const base = state.text ? bodyFont(model) : null;
  const sheets = pages.map((page, i) => renderPage(state, page, i === pages.length - 1, width, base));
  desk.append(...sheets);
  root.replaceChildren(desk);
  return sheets;
}

/** Character formatting of the first body paragraph: the one font and size text mode uses. */
function bodyFont(model: DocModel): CharProps {
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (block.kind === "paragraph" && block.heading === 0 && !block.title && block.runs.length > 0) return block.mark;
    }
  }
  return defaultCharProps();
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function renderPage(
  state: RenderState,
  page: PageContent,
  last: boolean,
  width: number,
  base: CharProps | null,
): HTMLElement {
  const { doc } = state;
  const s = page.section.props;
  const pageWidth = twipsToPx(s.pageWidth);
  const avail = availableSheetWidth(width);
  const scale = pageWidth > avail ? avail / pageWidth : 1;
  const side = (twips: number) => Math.max(Math.min(MIN_SIDE_MARGIN, twipsToPx(twips)), twipsToPx(twips) * scale);
  const headerBlocks = page.firstOfSection && s.titlePage ? page.section.firstHeader : page.section.header;
  const footerBlocks = page.firstOfSection && s.titlePage ? page.section.firstFooter : page.section.footer;

  const sheet = el(doc, "section", PAGE_CLASS);
  if (base) sheet.classList.add(TEXT_MODE_CLASS);
  sheet.setAttribute(
    "style",
    styleText({
      ...(base ? { "font-family": state.fonts.stack(base), "font-size": halfPoints(base.size) } : {}),
      width: px(pageWidth * scale),
      "min-height": px(twipsToPx(s.pageHeight) * scale),
      "padding-top": px(twipsToPx(headerBlocks.length > 0 ? s.headerTop : s.marginTop)),
      "padding-bottom": px(twipsToPx(footerBlocks.length > 0 ? s.footerBottom : s.marginBottom)),
      "padding-left": px(side(s.marginLeft)),
      "padding-right": px(side(s.marginRight)),
    }),
  );

  state.notes = [];
  if (headerBlocks.length > 0) {
    const header = el(doc, "header", "swl-doc-header");
    header.style.minHeight = px(twipsToPx(s.marginTop - s.headerTop));
    header.append(...renderBlocks(state, headerBlocks));
    sheet.append(header);
  }
  const body = el(doc, "article", "swl-doc-body");
  body.append(...renderBlocks(state, page.blocks));
  sheet.append(body);
  const footnotes = state.notes.map((i) => state.model.footnotes[i]).filter((n): n is DocNote => n !== undefined);
  if (footnotes.length > 0) sheet.append(renderNotes(state, footnotes, "swl-doc-notes"));
  if (last && state.model.endnotes.length > 0)
    sheet.append(renderNotes(state, state.model.endnotes, "swl-doc-notes swl-doc-endnotes"));
  if (footerBlocks.length > 0) {
    const footer = el(doc, "footer", "swl-doc-footer");
    footer.style.minHeight = px(twipsToPx(s.marginBottom - s.footerBottom));
    footer.append(...renderBlocks(state, footerBlocks));
    sheet.append(footer);
  }
  return sheet;
}

function renderNotes(state: RenderState, notes: readonly DocNote[], className: string): HTMLElement {
  const box = el(state.doc, "aside", className);
  box.append(el(state.doc, "hr", "swl-doc-notesep"));
  for (const note of notes) {
    const blocks = renderBlocks(state, note.blocks);
    const mark = el(state.doc, "sup");
    mark.textContent = note.mark;
    const first = blocks[0];
    if (first && first.localName !== "table") first.prepend(mark, " ");
    else box.append(mark);
    box.append(...blocks);
  }
  return box;
}

/** Vertical spacing between neighbours: Word adds space after and space before (no CSS-style collapsing). */
function spacings(blocks: readonly DocBlock[]): { top: number; bottom: number }[] {
  return blocks.map((b, i) => {
    if (b.kind !== "paragraph") return { top: 0, bottom: 0 };
    const next = blocks[i + 1];
    const prev = blocks[i - 1];
    const sameAsPrev = prev?.kind === "paragraph" && b.props.contextual && prev.style === b.style;
    const sameAsNext = next?.kind === "paragraph" && b.props.contextual && next.style === b.style;
    const top = i === 0 && !sameAsPrev ? b.props.spaceBefore : 0;
    let bottom = sameAsNext ? 0 : b.props.spaceAfter;
    if (next?.kind === "paragraph" && !(next.props.contextual && next.style === b.style))
      bottom += next.props.spaceBefore;
    return { top, bottom };
  });
}

function renderBlocks(state: RenderState, blocks: readonly DocBlock[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  const space = spacings(blocks);
  let list: HTMLUListElement | null = null;
  for (const [i, block] of blocks.entries()) {
    if (block.kind === "table") {
      list = null;
      out.push(renderTable(state, block));
      continue;
    }
    const inList = block.marker !== undefined && block.heading === 0;
    if (!inList) {
      list = null;
      out.push(renderParagraph(state, block, space[i]!, headingTag(block)));
      continue;
    }
    if (!list) {
      list = el(state.doc, "ul", "swl-doc-list");
      out.push(list);
    }
    list.append(renderParagraph(state, block, space[i]!, "li"));
  }
  return out;
}

function headingTag(p: DocParagraph): "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  if (p.title) return "h1";
  if (p.heading <= 0) return "p";
  return `h${Math.min(6, p.heading)}` as "h1";
}

function renderParagraph(
  state: RenderState,
  p: DocParagraph,
  spacing: { top: number; bottom: number },
  tag: "p" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
): HTMLElement {
  const node = el(state.doc, tag);
  if (state.text) {
    const { "background-color": _shading, ...layout } = paraCss(p.props, spacing);
    node.setAttribute("style", styleText(layout));
  } else {
    node.setAttribute("style", styleText({ ...charCss(p.mark, state.fonts), ...paraCss(p.props, spacing) }));
  }
  if (p.marker) node.append(renderMarker(state, p));
  for (const run of p.runs) {
    const child = renderRun(state, run, p);
    if (child) node.append(child);
  }
  if (!node.textContent?.trim() && !node.querySelector("img")) node.append(el(state.doc, "br"));
  return node;
}

function renderMarker(state: RenderState, p: DocParagraph): HTMLElement {
  const marker = el(state.doc, "span", "swl-doc-marker");
  marker.setAttribute("aria-hidden", "true");
  const text = mapSymbolText(p.marker ?? "");
  // A tab after the marker reaches the text indent of a hanging paragraph.
  if (p.markerFollow === "tab" && p.props.indentFirst < 0) {
    marker.style.minWidth = px(twipsToPx(-p.props.indentFirst));
    marker.textContent = text;
  } else {
    marker.textContent = p.markerFollow === "none" ? text : `${text} `;
  }
  return marker;
}

function renderRun(state: RenderState, run: DocRun, p: DocParagraph): Node | null {
  const { doc } = state;
  switch (run.kind) {
    case "text":
      return renderText(state, run, p);
    case "note": {
      if (run.note === "footnote" && !state.notes.includes(run.index)) state.notes.push(run.index);
      const sup = el(doc, "sup", "swl-doc-noteref");
      sup.textContent = run.mark;
      return sup;
    }
    case "image": {
      if (state.text) return null;
      const img = el(doc, "img");
      img.alt = "";
      img.src = run.src;
      img.width = Math.round(twipsToPx(run.width));
      img.height = Math.round(twipsToPx(run.height));
      return img;
    }
    case "page-break":
      return null;
  }
}

function renderText(state: RenderState, run: DocTextRun, p: DocParagraph): Node {
  const { doc } = state;
  const css = state.text ? {} : charCssDiff(run.props, p.mark, state.fonts);
  const tag = state.text
    ? "span"
    : run.props.vertAlign === "super"
      ? "sup"
      : run.props.vertAlign === "sub"
        ? "sub"
        : "span";
  const span = el(doc, tag);
  if (Object.keys(css).length > 0) span.setAttribute("style", styleText(css));
  const lines = run.text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i > 0) span.append(el(doc, "br"));
    if (line) span.append(line);
  }
  if (!run.href || !SAFE_HREF.test(run.href)) return span;
  const link = el(doc, "a");
  link.href = run.href;
  link.rel = "noopener noreferrer nofollow";
  link.append(span);
  return link;
}

function renderTable(state: RenderState, table: DocTable): HTMLElement {
  const { doc } = state;
  const node = el(doc, "table", "swl-doc-table");
  const columns = table.rows.find((r) => r.columns && r.columns.length > 1)?.columns ?? null;
  if (table.rows.some((r) => r.borders !== false)) node.classList.add("swl-doc-grid");
  if (columns) {
    const total = columns[columns.length - 1]! - columns[0]!;
    if (total > 0) {
      node.style.width = px(twipsToPx(total));
      if (columns[0]) node.style.marginLeft = px(twipsToPx(columns[0]));
      const group = el(doc, "colgroup");
      for (let i = 0; i + 1 < columns.length; i++) {
        const col = el(doc, "col");
        col.style.width = `${Math.round(((columns[i + 1]! - columns[i]!) / total) * 10000) / 100}%`;
        group.append(col);
      }
      node.append(group);
    }
  } else {
    node.style.width = "100%";
  }
  const body = el(doc, "tbody");
  for (const row of table.rows) {
    const tr = el(doc, "tr");
    for (const cell of row.cells) {
      const td = el(doc, "td");
      td.append(...renderBlocks(state, cell.blocks));
      tr.append(td);
    }
    body.append(tr);
  }
  node.append(body);
  return node;
}
