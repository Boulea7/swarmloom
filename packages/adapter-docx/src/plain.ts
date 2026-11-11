import { DocxError } from "./errors";
import { type DocxPackage, type ParagraphStyle, relatedPart } from "./package";
import { fontStack } from "./paged/fonts";
import { chineseCounting, cjkDecimal, roman, wordLetters } from "./paged/numbering";
import { mapSymbolText } from "./paged/symbols";
import { parseXml, R_NS, W_NS, wAttr, wChild, wChildren, wInt, wToggle } from "./xml";

/** Desk and sheet classes of the plain renderer. */
export const PLAIN_DESK = "swl-plain";
export const PLAIN_PAGE = "swl-plain-page";

/** Content the plain renderer leaves out, for the quality notes. */
export interface PlainOmissions {
  pictures: number;
  footnotes: number;
  headersFooters: boolean;
}

/** Result of {@link renderPlain}. */
export interface PlainResult {
  /** Page sheets in document order. */
  pages: HTMLElement[];
  omitted: PlainOmissions;
}

/** Options of {@link renderPlain}. */
export interface PlainOptions {
  /** Paragraph styles of the package (headings and list numbering). */
  styles: ReadonlyMap<string, ParagraphStyle>;
  /** Start sheets at the page breaks Word saved in the file. */
  savedPageBreaks: boolean;
}

/**
 * CSS of the plain renderer. Sheets get their size and margins inline; this sets typography close to
 * Word's defaults (Calibri 11 pt with the shared fallbacks).
 */
export function plainCss(): string {
  return `
.${PLAIN_DESK} { font-family: ${fontStack("Calibri")}; font-size: 11pt; line-height: 1.25; color: #000000;
  font-weight: 400; font-style: normal; letter-spacing: normal; text-align: start; }
.${PLAIN_PAGE} p, .${PLAIN_PAGE} h1, .${PLAIN_PAGE} h2, .${PLAIN_PAGE} h3, .${PLAIN_PAGE} h4, .${PLAIN_PAGE} h5,
.${PLAIN_PAGE} h6 { margin: 0 0 8pt; overflow-wrap: break-word; }
.${PLAIN_PAGE} h1 { font-size: 16pt; font-weight: 600; margin-top: 12pt; color: #1f3763; }
.${PLAIN_PAGE} h2 { font-size: 13pt; font-weight: 600; margin-top: 10pt; color: #2f5496; }
.${PLAIN_PAGE} h3, .${PLAIN_PAGE} h4, .${PLAIN_PAGE} h5, .${PLAIN_PAGE} h6 { font-size: 11pt; font-weight: 600;
  margin-top: 8pt; color: #1f3763; }
.${PLAIN_PAGE} .swl-plain-title { font-size: 26pt; font-weight: 400; margin-top: 0; color: #000000; }
.${PLAIN_PAGE} .swl-plain-marker { display: inline-block; min-width: 18pt; text-indent: 0; }
.${PLAIN_PAGE} table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; table-layout: auto; }
.${PLAIN_PAGE} td { border: 1px solid #bfbfbf; padding: 2pt 5pt; vertical-align: top; }
.${PLAIN_PAGE} td > p:last-child { margin-bottom: 0; }
.${PLAIN_PAGE} a { color: #0563c1; text-decoration: underline; }
`;
}

interface Geometry {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** US Letter with 1 inch margins, Word's default, px. */
const DEFAULT_GEOMETRY: Geometry = { width: 816, height: 1056, top: 96, right: 96, bottom: 96, left: 96 };
const TWIP_PX = 1 / 15;
const MAX_TABLE_DEPTH = 8;
const SAFE_LINK = /^(?:https?:|mailto:)/i;

function geometry(sectPr: Element | null): Geometry {
  if (!sectPr) return DEFAULT_GEOMETRY;
  const size = wChild(sectPr, "pgSz");
  const margin = wChild(sectPr, "pgMar");
  const px = (el: Element | null, name: string, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, wInt(el, name, fallback / TWIP_PX) * TWIP_PX));
  const width = px(size, "w", DEFAULT_GEOMETRY.width, 100, 8000);
  return {
    width,
    height: px(size, "h", DEFAULT_GEOMETRY.height, 100, 8000),
    top: px(margin, "top", DEFAULT_GEOMETRY.top, 0, 2000),
    bottom: px(margin, "bottom", DEFAULT_GEOMETRY.bottom, 0, 2000),
    left: px(margin, "left", DEFAULT_GEOMETRY.left, 0, width / 3),
    right: px(margin, "right", DEFAULT_GEOMETRY.right, 0, width / 3),
  };
}

interface Level {
  format: string;
  text: string;
  start: number;
  indent: number;
}

/** List levels by w:numId, then by w:ilvl, from the numbering part. */
function readNumbering(pkg: DocxPackage): Map<string, Map<number, Level>> {
  const out = new Map<string, Map<number, Level>>();
  const path = relatedPart(pkg, "/numbering", "word/numbering.xml");
  const text = pkg.xml(path);
  if (!text) return out;
  const doc = parseXml(text, path);
  const root = doc.documentElement;
  const abstract = new Map<string, Map<number, Level>>();
  for (const def of wChildren(root, "abstractNum")) {
    const levels = new Map<number, Level>();
    for (const lvl of wChildren(def, "lvl")) {
      const ilvl = Number(wAttr(lvl, "ilvl") ?? 0);
      levels.set(ilvl, {
        format: wAttr(wChild(lvl, "numFmt"), "val") ?? "decimal",
        text: wAttr(wChild(lvl, "lvlText"), "val") ?? "",
        start: wInt(wChild(lvl, "start"), "val", 1),
        indent: wInt(wChild(wChild(lvl, "pPr"), "ind"), "left", 720 * (ilvl + 1)) * TWIP_PX,
      });
    }
    const id = wAttr(def, "abstractNumId");
    if (id !== null) abstract.set(id, levels);
  }
  for (const num of wChildren(root, "num")) {
    const id = wAttr(num, "numId");
    const levels = abstract.get(wAttr(wChild(num, "abstractNumId"), "val") ?? "");
    if (id !== null && levels) out.set(id, levels);
  }
  return out;
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case "decimalZero":
      return n >= 0 && n < 10 ? `0${n}` : String(n);
    case "lowerLetter":
      return wordLetters(n);
    case "upperLetter":
      return wordLetters(n).toUpperCase();
    case "lowerRoman":
      return roman(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "chineseCounting":
    case "chineseCountingThousand":
    case "ideographTraditional":
      return chineseCounting(n);
    case "ideographDigital":
      return cjkDecimal(n);
    case "none":
    case "bullet":
      return "";
    default:
      return String(n);
  }
}

/** Children of a block container with content controls and custom XML wrappers unwrapped. */
function blocks(parent: Element): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === "sdt") {
      const content = wChild(child, "sdtContent");
      if (content) out.push(...blocks(content));
    } else if (child.localName === "customXml") out.push(...blocks(child));
    else out.push(child);
  }
  return out;
}

/**
 * The built-in fallback renderer, used when docx-preview fails: semantic HTML (headings, paragraphs,
 * lists, tables, links, bold/italic/underline) on page sheets that start at sections and explicit page
 * breaks. Pictures, headers, footers and footnotes are left out and counted in `omitted`.
 *
 * @throws DocxError ("corrupt") when the main document has no body.
 */
export function renderPlain(pkg: DocxPackage, host: HTMLElement, options: PlainOptions): PlainResult {
  const main = pkg.xml(pkg.main);
  const body = main ? wChild(parseXml(main, pkg.main).documentElement, "body") : null;
  if (!body) throw new DocxError("corrupt", "the main document has no body");
  return new PlainWriter(pkg, host, options).run(body);
}

class PlainWriter {
  private readonly doc: Document;
  private readonly desk: HTMLElement;
  private readonly numbering: Map<string, Map<number, Level>>;
  private readonly counters = new Map<string, number[]>();
  private readonly pages: HTMLElement[] = [];
  private readonly omitted: PlainOmissions = { pictures: 0, footnotes: 0, headersFooters: false };
  private page: HTMLElement | null = null;
  private geometry: Geometry = DEFAULT_GEOMETRY;

  constructor(
    private readonly pkg: DocxPackage,
    host: HTMLElement,
    private readonly options: PlainOptions,
  ) {
    this.doc = host.ownerDocument;
    this.desk = this.el("div", PLAIN_DESK);
    host.append(this.desk);
    this.numbering = readNumbering(pkg);
  }

  run(body: Element): PlainResult {
    const sections: { content: Element[]; sectPr: Element | null }[] = [];
    let content: Element[] = [];
    for (const block of blocks(body)) {
      if (block.localName === "sectPr") continue;
      content.push(block);
      const sectPr = block.localName === "p" ? wChild(wChild(block, "pPr"), "sectPr") : null;
      if (sectPr) {
        sections.push({ content, sectPr });
        content = [];
      }
    }
    sections.push({ content, sectPr: wChild(body, "sectPr") });
    for (const section of sections) {
      if (wChild(section.sectPr, "headerReference") || wChild(section.sectPr, "footerReference")) {
        this.omitted.headersFooters = true;
      }
      const continuous = wAttr(wChild(section.sectPr, "type"), "val") === "continuous";
      this.geometry = geometry(section.sectPr);
      if (!this.page || !continuous) this.newPage();
      for (const block of section.content) this.block(block, null, 0);
    }
    return { pages: this.pages, omitted: this.omitted };
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  private newPage(): void {
    const g = this.geometry;
    const page = this.el("section", PLAIN_PAGE);
    page.style.cssText = `width:${g.width}px;min-height:${g.height}px;padding:${g.top}px ${g.right}px ${g.bottom}px ${g.left}px;`;
    this.desk.append(page);
    this.pages.push(page);
    this.page = page;
  }

  /** Renders one block into `container` (a table cell) or, when null, into the current page. */
  private block(block: Element, container: HTMLElement | null, depth: number): void {
    if (block.localName === "p") this.paragraph(block, container);
    else if (block.localName === "tbl") this.table(block, container, depth);
  }

  private table(tbl: Element, container: HTMLElement | null, depth: number): void {
    if (depth >= MAX_TABLE_DEPTH) {
      for (const row of wChildren(tbl, "tr"))
        for (const cell of wChildren(row, "tc")) for (const b of blocks(cell)) this.block(b, container, depth);
      return;
    }
    const table = this.el("table");
    const body = this.el("tbody");
    table.append(body);
    for (const row of wChildren(tbl, "tr")) {
      const tr = this.el("tr");
      for (const cell of wChildren(row, "tc")) {
        const td = this.el("td");
        const tcPr = wChild(cell, "tcPr");
        const span = wInt(wChild(tcPr, "gridSpan"), "val", 1);
        if (span > 1 && span <= 64) td.colSpan = span;
        const merge = wChild(tcPr, "vMerge");
        const continued = merge !== null && wAttr(merge, "val") !== "restart";
        if (!continued) for (const b of blocks(cell)) this.block(b, td, depth + 1);
        tr.append(td);
      }
      body.append(tr);
    }
    (container ?? this.page)?.append(table);
  }

  private paragraph(p: Element, container: HTMLElement | null): void {
    const pPr = wChild(p, "pPr");
    const style = this.options.styles.get(wAttr(wChild(pPr, "pStyle"), "val") ?? "");
    const topLevel = container === null;
    if (topLevel && wToggle(pPr, "pageBreakBefore") && this.page?.hasChildNodes()) this.newPage();
    const make = (): HTMLElement => {
      const heading = style?.heading;
      let node: HTMLElement;
      if (heading && heading.level <= 6) node = this.el(`h${heading.level}` as "h1");
      else {
        node = this.el("p");
        if (heading) {
          node.setAttribute("role", "heading");
          node.setAttribute("aria-level", String(heading.level));
        }
      }
      if (heading?.title) node.className = "swl-plain-title";
      const align = wAttr(wChild(pPr, "jc"), "val");
      if (align === "center" || align === "right" || align === "both" || align === "end") {
        node.style.textAlign = align === "both" ? "justify" : align === "end" ? "right" : align;
      }
      return node;
    };
    let node = make();
    this.listMarker(node, pPr, style);
    const flush = (): void => {
      if (!node.hasChildNodes()) node.append(this.el("br"));
      (container ?? this.page)?.append(node);
    };
    const pageBreak = (): void => {
      if (!topLevel) {
        node.append(this.el("br"));
        return;
      }
      const markerOnly = node.childNodes.length === 1 && node.firstElementChild?.className === "swl-plain-marker";
      // A saved break right after an explicit one would otherwise leave an empty sheet.
      if ((!node.hasChildNodes() || markerOnly) && !this.page?.hasChildNodes()) return;
      if (node.hasChildNodes() && !markerOnly) {
        flush();
        node = make();
      }
      this.newPage();
    };
    this.inline(p, () => node, pageBreak);
    flush();
  }

  private listMarker(node: HTMLElement, pPr: Element | null, style: ParagraphStyle | undefined): void {
    const numPr = wChild(pPr, "numPr");
    const numId = wAttr(wChild(numPr, "numId"), "val") ?? style?.numbering?.numId;
    if (!numId || numId === "0") return;
    const ilvl = Math.min(8, Math.max(0, wInt(wChild(numPr, "ilvl"), "val", style?.numbering?.ilvl ?? 0)));
    const levels = this.numbering.get(numId);
    const level = levels?.get(ilvl);
    if (!levels || !level) return;
    const counts = this.counters.get(numId) ?? [];
    this.counters.set(numId, counts);
    counts[ilvl] = (counts[ilvl] ?? level.start - 1) + 1;
    counts.length = ilvl + 1;
    const text =
      level.format === "bullet"
        ? mapSymbolText(level.text) || "•"
        : level.text.replace(/%([1-9])/g, (_, d: string) => {
            const index = Number(d) - 1;
            const other = levels.get(index);
            return formatNumber(counts[index] ?? other?.start ?? 1, other?.format ?? "decimal");
          });
    if (!text) return;
    const marker = this.el("span", "swl-plain-marker");
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = text;
    node.style.paddingLeft = `${Math.min(400, level.indent)}px`;
    node.style.textIndent = "-18pt";
    node.append(marker);
  }

  /** Appends the runs of a paragraph (or of a hyperlink / inserted span) to the node `target()` returns. */
  private inline(parent: Element, target: () => HTMLElement, pageBreak: () => void): void {
    for (const child of Array.from(parent.children)) {
      if (child.namespaceURI !== W_NS) continue;
      switch (child.localName) {
        case "r":
          this.textRun(child, target, pageBreak);
          break;
        case "hyperlink": {
          const link = this.link(child);
          if (link) {
            target().append(link);
            this.inline(child, () => link, pageBreak);
          } else this.inline(child, target, pageBreak);
          break;
        }
        case "ins":
        case "moveTo":
        case "smartTag":
        case "fldSimple":
        case "customXml":
          this.inline(child, target, pageBreak);
          break;
        case "sdt": {
          const content = wChild(child, "sdtContent");
          if (content) this.inline(content, target, pageBreak);
          break;
        }
        default:
          // Deleted text (w:del, w:moveFrom), bookmarks, comments and proofing marks are not shown.
          break;
      }
    }
  }

  private link(hyperlink: Element): HTMLAnchorElement | null {
    const id = hyperlink.getAttributeNS(R_NS, "id") ?? hyperlink.getAttribute("r:id");
    const rel = id ? this.pkg.rels(this.pkg.main).get(id) : undefined;
    if (!rel?.external || !SAFE_LINK.test(rel.target.trim())) return null;
    const a = this.el("a");
    a.href = rel.target.trim();
    a.rel = "noopener noreferrer";
    return a;
  }

  private textRun(r: Element, target: () => HTMLElement, pageBreak: () => void): void {
    const rPr = wChild(r, "rPr");
    const wrap = (): HTMLElement => {
      const parent = target();
      let node: HTMLElement = parent;
      const tags: (keyof HTMLElementTagNameMap)[] = [];
      if (wToggle(rPr, "b")) tags.push("b");
      if (wToggle(rPr, "i")) tags.push("i");
      const underline = wAttr(wChild(rPr, "u"), "val");
      if (underline && underline !== "none") tags.push("u");
      if (wToggle(rPr, "strike") || wToggle(rPr, "dstrike")) tags.push("s");
      const vertical = wAttr(wChild(rPr, "vertAlign"), "val");
      if (vertical === "superscript") tags.push("sup");
      else if (vertical === "subscript") tags.push("sub");
      for (const tag of tags) {
        const inner = this.el(tag);
        node.append(inner);
        node = inner;
      }
      return node;
    };
    if (wToggle(rPr, "vanish")) return;
    let out: HTMLElement | null = null;
    const text = (value: string): void => {
      out ??= wrap();
      const last = out.lastChild;
      if (last && last.nodeType === 3) (last as Text).appendData(value);
      else out.append(this.doc.createTextNode(value));
    };
    for (const child of Array.from(r.children)) {
      if (child.namespaceURI !== W_NS) continue;
      switch (child.localName) {
        case "t":
          text(child.textContent ?? "");
          break;
        case "tab":
          text(" ");
          break;
        case "noBreakHyphen":
          text("‑");
          break;
        case "softHyphen":
          text("­");
          break;
        case "sym": {
          const code = Number.parseInt(wAttr(child, "char") ?? "", 16);
          if (Number.isFinite(code) && code > 0) text(mapSymbolText(String.fromCodePoint(code)));
          break;
        }
        case "br":
        case "cr": {
          if (wAttr(child, "type") === "page") {
            pageBreak();
            out = null;
          } else (out ?? target()).append(this.el("br"));
          break;
        }
        case "lastRenderedPageBreak":
          if (this.options.savedPageBreaks) {
            pageBreak();
            out = null;
          }
          break;
        case "drawing":
        case "pict":
        case "object":
          this.omitted.pictures++;
          break;
        case "footnoteReference":
        case "endnoteReference":
          this.omitted.footnotes++;
          break;
        default:
          break;
      }
    }
  }
}
