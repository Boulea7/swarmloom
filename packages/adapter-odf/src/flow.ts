import type { ContentBudget } from "./kit/budget";
import { lengthPx, px, styleText } from "./kit/css";
import { attrs, cleanText, escapeHtml } from "./kit/html";
import { a, child, children, isOdf, NS } from "./ns";
import type { OdfPackage } from "./package";
import type { StyleClasses } from "./style-css";
import type { OdfStyles } from "./styles";

/** Things a render pass leaves out or approximates, reported as quality notes. */
export interface FlowStats {
  /** Embedded objects (charts, formulas, OLE) drawn as placeholders. */
  objects: number;
  /** Rows or columns cut from oversized tables. */
  tableCuts: number;
}

/** Shared state of one render pass over ODF text content. */
export interface FlowContext {
  pkg: OdfPackage;
  styles: OdfStyles;
  classes: StyleClasses;
  budget: ContentBudget;
  stats: FlowStats;
  /** Which automatic styles names resolve against (master pages live in styles.xml). */
  scope: "content" | "styles";
  /** Footnotes collected on the current sheet. */
  notes: string[];
  /** Frames met inside a paragraph that cannot live in it (text boxes, block images); placed after it. */
  hoisted: string[];
  /** Current page number and count for page fields. */
  page: number;
  pages?: number;
}

/** Most columns and rows of a text-document table (repeated columns are expanded up to this). */
const MAX_TABLE_COLUMNS = 64;
const MAX_TABLE_ROWS = 400;
const MAX_REPEAT = 64;

const SKIP_INLINE = new Set([
  "bookmark",
  "bookmark-start",
  "bookmark-end",
  "reference-mark",
  "reference-mark-start",
  "reference-mark-end",
  "annotation",
  "annotation-end",
  "change",
  "change-start",
  "change-end",
  "soft-page-break",
  "alphabetical-index-mark",
  "toc-mark",
]);

const SKIP_BLOCK = new Set([
  "tracked-changes",
  "sequence-decls",
  "variable-decls",
  "user-field-decls",
  "dde-connection-decls",
  "forms",
  "calculation-settings",
  "content-validations",
  "label-ranges",
  "named-expressions",
  "database-ranges",
  "annotation",
  "notes",
  "soft-page-break",
]);

function cls(...names: (string | undefined)[]): string | undefined {
  const joined = names.filter((n) => n).join(" ");
  return joined || undefined;
}

function spaces(n: number): string {
  return "\u00A0".repeat(Math.max(1, Math.min(n, 200)));
}

/** Renders the inline content of a paragraph, heading or span. */
export function inline(el: Element, fc: FlowContext): string {
  let out = "";
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      out += escapeHtml(cleanText((n.nodeValue ?? "").replace(/[\t\r\n]+/g, " ")));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (e.namespaceURI === NS.text) {
      const local = e.localName;
      if (SKIP_INLINE.has(local)) continue;
      if (local === "s") out += spaces(Number(a(e, "text:c") ?? 1) || 1);
      else if (local === "tab") out += '<span class="odf-tab">\t</span>';
      else if (local === "line-break") out += "<br>";
      else if (local === "span")
        out += `<span${attrs({ class: fc.classes.of("text", a(e, "text:style-name"), fc.scope) })}>${inline(e, fc)}</span>`;
      else if (local === "a") out += `<span class="odf-link">${inline(e, fc)}</span>`;
      else if (local === "note") out += note(e, fc);
      else if (local === "page-number") out += String(fc.page);
      else if (local === "page-count" && fc.pages) out += String(fc.pages);
      else if (local === "ruby") out += ruby(e, fc);
      else out += inline(e, fc);
    } else if (isOdf(e, "draw", "frame")) {
      if (isInlineFrame(e)) out += frame(e, fc, "inline");
      else fc.hoisted.push(frame(e, fc, "block"));
    } else if (isOdf(e, "draw", "a")) out += inline(e, fc);
    else if (isOdf(e, "office", "annotation")) continue;
    else out += inline(e, fc);
  }
  return out;
}

function ruby(el: Element, fc: FlowContext): string {
  const base = child(el, "text", "ruby-base");
  const text = child(el, "text", "ruby-text");
  return `<ruby>${base ? inline(base, fc) : ""}<rt>${escapeHtml(text?.textContent ?? "")}</rt></ruby>`;
}

function note(el: Element, fc: FlowContext): string {
  const citation = escapeHtml((child(el, "text", "note-citation")?.textContent ?? "*").trim());
  const body = child(el, "text", "note-body");
  if (body) {
    const lines = Array.from(body.children)
      .filter((p) => isOdf(p, "text", "p") || isOdf(p, "text", "h"))
      .map((p) => inline(p, fc));
    fc.notes.push(`<p class="odf-note"><sup>${citation}</sup> ${lines.join("<br>")}</p>`);
  }
  return `<sup class="odf-noteref">${citation}</sup>`;
}

function plainLength(el: Element): number {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
}

/** A paragraph or heading. Returns "" when the budget is spent. */
export function paragraph(el: Element, fc: FlowContext): string {
  if (!fc.budget.take(plainLength(el))) return "";
  const style = a(el, "text:style-name");
  const outer = fc.hoisted;
  fc.hoisted = [];
  const body = inline(el, fc);
  const after = fc.hoisted.join("");
  fc.hoisted = outer;
  // A paragraph that only anchors frames contributes the frames, not an empty line.
  if (body.trim() === "" && after) return after;
  const content = body.trim() === "" ? "<br>" : body;
  const klass = fc.classes.of("paragraph", style, fc.scope);
  if (isOdf(el, "text", "h")) {
    const level = Math.max(1, Math.min(6, Number(a(el, "text:outline-level") ?? 1) || 1));
    return `<h${level}${attrs({ class: klass })}>${content}</h${level}>${after}`;
  }
  return `<p${attrs({ class: klass })}>${content}</p>${after}`;
}

/** Block children of a container (cell, text box, section, note, list item). */
export function blocks(el: Element, fc: FlowContext, listLevel = 0, listStyle?: string): string[] {
  const out: string[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const html = block(c, fc, listLevel, listStyle);
    if (html) out.push(html);
  }
  return out;
}

/** One block-level element. */
export function block(c: Element, fc: FlowContext, listLevel = 0, listStyle?: string): string {
  if (isOdf(c, "text", "p") || isOdf(c, "text", "h")) return paragraph(c, fc);
  if (isOdf(c, "text", "list")) return list(c, fc, listLevel + 1, listStyle);
  if (isOdf(c, "table", "table")) return table(c, fc);
  if (isOdf(c, "draw", "frame")) return frame(c, fc, "block");
  if (isOdf(c, "text", "section"))
    return `<div${attrs({ class: fc.classes.of("section", a(c, "text:style-name"), fc.scope) })}>${blocks(c, fc).join("")}</div>`;
  if (SKIP_BLOCK.has(c.localName)) return "";
  // Indexes (tables of contents...) keep their last rendered text in index-body; other unknown
  // containers are unwrapped.
  return blocks(c, fc, listLevel, listStyle).join("");
}

const NUMBER_FORMATS: Record<string, string> = {
  "1": "decimal",
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};

function bulletType(bullet: string | undefined): string {
  const ch = [...(bullet ?? "")][0] ?? "\u2022";
  const cp = ch.codePointAt(0) ?? 0;
  // Symbol-font bullets live in the Private Use Area and would render as boxes.
  const safe = cp >= 0xe000 && cp <= 0xf8ff ? "\u2022" : ch.replace(/["\\\n\r]/g, "");
  return `"${safe} "`;
}

function list(el: Element, fc: FlowContext, level: number, inherited?: string): string {
  const name = a(el, "text:style-name") ?? inherited;
  const lvl = fc.styles.listLevel(name, level);
  const parentIndent = level > 1 ? (fc.styles.listLevel(name, level - 1).indent ?? 24 * (level - 1)) : 0;
  const indent = Math.max(16, Math.min(160, (lvl.indent ?? 24 * level) - parentIndent));
  const numbered = lvl.kind === "number";
  const type =
    lvl.kind === "none" ? "none" : numbered ? (NUMBER_FORMATS[lvl.format ?? "1"] ?? "decimal") : bulletType(lvl.bullet);
  const style = styleText({ "list-style-type": type, "padding-left": px(indent) });
  const items: string[] = [];
  for (const item of Array.from(el.children)) {
    const header = isOdf(item, "text", "list-header");
    if (!header && !isOdf(item, "text", "list-item")) continue;
    const inner = blocks(item, fc, level, name).join("");
    if (!inner) continue;
    const start = a(item, "text:start-value");
    items.push(
      `<li${attrs({ value: numbered && start ? Number(start) || undefined : undefined, style: header ? "list-style:none" : undefined })}>${inner}</li>`,
    );
  }
  if (items.length === 0) return "";
  const tag = numbered ? "ol" : "ul";
  const start = numbered && lvl.start !== 1 ? lvl.start : undefined;
  return `<${tag}${attrs({ class: "odf-list", style, start })}>${items.join("")}</${tag}>`;
}

/** Row elements of a table, flattening header rows and row groups. */
export function tableRows(el: Element): Element[] {
  const rows: Element[] = [];
  const stack = Array.from(el.children).reverse();
  while (stack.length > 0) {
    const c = stack.pop() as Element;
    if (isOdf(c, "table", "table-row")) rows.push(c);
    else if (c.namespaceURI === NS.table && /^table-(?:header-rows|rows|row-group)$/.test(c.localName)) {
      stack.push(...Array.from(c.children).reverse());
    }
  }
  return rows;
}

/** Column widths of a table in px (repeated columns expanded, capped). */
export function tableColumns(el: Element, fc: FlowContext, max: number): (number | undefined)[] {
  const widths: (number | undefined)[] = [];
  const stack = Array.from(el.children).reverse();
  while (stack.length > 0 && widths.length < max) {
    const c = stack.pop() as Element;
    if (isOdf(c, "table", "table-column")) {
      const style = fc.styles.resolve("table-column", a(c, "table:style-name"), fc.scope);
      const width = lengthPx(style?.props["table-column"]?.get("style:column-width"));
      const repeat = Math.min(Number(a(c, "table:number-columns-repeated") ?? 1) || 1, max - widths.length);
      for (let i = 0; i < repeat; i++) widths.push(width);
    } else if (c.namespaceURI === NS.table && /^table-(?:header-columns|columns|column-group)$/.test(c.localName)) {
      stack.push(...Array.from(c.children).reverse());
    }
  }
  return widths;
}

function table(el: Element, fc: FlowContext): string {
  if (fc.budget.exhausted) {
    fc.budget.take();
    return "";
  }
  const widths = tableColumns(el, fc, MAX_TABLE_COLUMNS);
  const tableStyle = fc.styles.resolve("table", a(el, "table:style-name"), fc.scope);
  const tp = tableStyle?.props.table;
  const css: Record<string, string> = {};
  const width = lengthPx(tp?.get("style:width"));
  if (width) css.width = px(width);
  const align = tp?.get("table:align");
  if (align === "center") css["margin-inline"] = "auto";
  else if (align === "right") css["margin-left"] = "auto";
  const rows: string[] = [];
  let rowCount = 0;
  for (const row of tableRows(el)) {
    if (fc.budget.exhausted || rowCount >= MAX_TABLE_ROWS) {
      fc.stats.tableCuts++;
      break;
    }
    const repeat = Math.min(Number(a(row, "table:number-rows-repeated") ?? 1) || 1, MAX_REPEAT);
    const rowStyle = fc.styles.resolve("table-row", a(row, "table:style-name"), fc.scope);
    const height = lengthPx(
      rowStyle?.props["table-row"]?.get("style:row-height") ??
        rowStyle?.props["table-row"]?.get("style:min-row-height"),
    );
    const cells = rowCells(row, fc);
    for (let i = 0; i < repeat; i++) {
      rows.push(`<tr${attrs({ style: height ? `height:${px(height)}` : undefined })}>${cells}</tr>`);
      rowCount++;
    }
  }
  if (rows.length === 0) return "";
  const cols = widths.some((w) => w !== undefined)
    ? `<colgroup>${widths.map((w) => `<col${attrs({ style: w ? `width:${px(w)}` : undefined })}>`).join("")}</colgroup>`
    : "";
  return `<table${attrs({ class: "odf-table", style: styleText(css) })}>${cols}<tbody>${rows.join("")}</tbody></table>`;
}

function rowCells(row: Element, fc: FlowContext): string {
  let out = "";
  let columns = 0;
  for (const cell of children(row, "table", "table-cell")) {
    if (columns >= MAX_TABLE_COLUMNS) break;
    const repeat = Math.min(Number(a(cell, "table:number-columns-repeated") ?? 1) || 1, MAX_TABLE_COLUMNS - columns);
    const colspan = Math.max(1, Math.min(Number(a(cell, "table:number-columns-spanned") ?? 1) || 1, MAX_TABLE_COLUMNS));
    const rowspan = Math.max(1, Math.min(Number(a(cell, "table:number-rows-spanned") ?? 1) || 1, MAX_TABLE_ROWS));
    fc.budget.take(0);
    const content = blocks(cell, fc).join("");
    const html = `<td${attrs({
      class: cls("odf-cell", fc.classes.of("table-cell", a(cell, "table:style-name"), fc.scope)),
      colspan: colspan > 1 ? colspan : undefined,
      rowspan: rowspan > 1 ? rowspan : undefined,
    })}>${content}</td>`;
    for (let i = 0; i < repeat; i++) out += html;
    columns += repeat * colspan;
  }
  return out;
}

/** Geometry of a `draw:frame` or shape in px. */
export interface FrameBox {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export function frameBox(el: Element): FrameBox {
  const box: FrameBox = {};
  const x = lengthPx(a(el, "svg:x"));
  const y = lengthPx(a(el, "svg:y"));
  const w = lengthPx(a(el, "svg:width"));
  const h = lengthPx(a(el, "svg:height") ?? a(el, "fo:min-height"));
  if (x !== undefined) box.x = x;
  if (y !== undefined) box.y = y;
  if (w !== undefined && w > 0) box.w = Math.min(w, 4000);
  if (h !== undefined && h > 0) box.h = Math.min(h, 6000);
  return box;
}

/** The inner HTML of a frame: its image, text box, table or a placeholder for embedded objects. */
export function frameContent(el: Element, fc: FlowContext): string {
  for (const image of children(el, "draw", "image")) {
    const src = fc.pkg.image(image);
    if (src) return `<img class="odf-img"${attrs({ src, alt: frameTitle(el) })}>`;
  }
  const textBox = child(el, "draw", "text-box");
  if (textBox) return blocks(textBox, fc).join("");
  const tableEl = child(el, "table", "table");
  if (tableEl) return table(tableEl, fc);
  if (child(el, "draw", "object") || child(el, "draw", "object-ole") || child(el, "draw", "plugin")) {
    fc.stats.objects++;
    return '<span class="odf-object">Embedded object</span>';
  }
  if (child(el, "draw", "image")) return '<span class="odf-object">Image</span>';
  return "";
}

function frameTitle(el: Element): string | undefined {
  const title = child(el, "svg", "title") ?? child(el, "svg", "desc");
  return title?.textContent?.trim() || a(el, "draw:name") || undefined;
}

/** True for frames that sit in a line of text: anchored as a character and holding only an image. */
function isInlineFrame(el: Element): boolean {
  return a(el, "text:anchor-type") === "as-char" && !child(el, "draw", "text-box") && !child(el, "table", "table");
}

/**
 * A frame placed in the text flow: inline when anchored as a character, otherwise a block aligned
 * like the original (floating frames are not positioned exactly).
 */
export function frame(el: Element, fc: FlowContext, mode: "inline" | "block"): string {
  if (!fc.budget.take(0)) return "";
  const box = frameBox(el);
  const inner = frameContent(el, fc);
  if (!inner) return "";
  const graphic = fc.styles.resolve("graphic", a(el, "draw:style-name"), fc.scope)?.props.graphic;
  const asChar = mode === "inline";
  const css: Record<string, string> = { display: asChar ? "inline-block" : "block" };
  if (box.w) css.width = px(box.w);
  if (box.h && child(el, "draw", "text-box") === undefined) css.height = px(box.h);
  else if (box.h) css["min-height"] = px(box.h);
  if (!asChar) {
    const pos = graphic?.get("style:horizontal-pos");
    if (pos === "center") css["margin-inline"] = "auto";
    else if (pos === "right" || pos === "outside") css["margin-left"] = "auto";
  } else css["vertical-align"] = "bottom";
  const tag = asChar ? "span" : "div";
  const klass = cls("odf-frame", fc.classes.of("graphic", a(el, "draw:style-name"), fc.scope));
  return `<${tag}${attrs({ class: klass, style: styleText(css) })}>${inner}</${tag}>`;
}
