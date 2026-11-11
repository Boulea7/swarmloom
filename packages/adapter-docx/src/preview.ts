import type { HeadingStyle } from "./package";
import { chineseCounting, roman, wordLetters } from "./paged/numbering";
import { availableSheetWidth } from "./paged/theme";

/** Class prefix handed to docx-preview: pages are `section.swl-docx` inside `.swl-docx-wrapper`. */
export const PREVIEW_CLASS = "swl-docx";
export const PREVIEW_WRAPPER = `${PREVIEW_CLASS}-wrapper`;

/** Options of {@link renderPreview}. */
export interface PreviewOptions {
  /** Start sheets at the page breaks Word saved in the file (`w:lastRenderedPageBreak`). */
  savedPageBreaks: boolean;
}

/**
 * Renders a DOCX with docx-preview (loaded on first use) into `body`, its style sheets into `styles`,
 * and returns the page sheets in document order.
 *
 * Pages come only from section starts, explicit page breaks and, when enabled, Word's saved page
 * breaks. Word's live pagination is not reproduced. Between parsing and rendering, the parsed model is
 * adjusted so that docx-preview's page grouping follows those rules (see {@link adjustPageBreaks}).
 * Pictures and embedded fonts become data URLs so the result does not depend on object URL
 * lifetimes. Alternative-format chunks (embedded HTML rendered in iframes), comments and tracked
 * changes are not rendered.
 */
export async function renderPreview(
  bytes: Uint8Array,
  body: HTMLElement,
  styles: HTMLElement,
  options: PreviewOptions,
): Promise<HTMLElement[]> {
  const { parseAsync, renderDocument } = await import("docx-preview");
  const settings = {
    className: PREVIEW_CLASS,
    inWrapper: true,
    hideWrapperOnPrint: false,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    // Always false: with true, docx-preview turns every section (even continuous ones) into a sheet.
    // Saved breaks are removed from the model instead when they are not wanted.
    ignoreLastRenderedPageBreak: false,
    experimental: false,
    trimXmlDeclaration: true,
    useBase64URL: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderChanges: false,
    renderAltChunks: false,
    debug: false,
  };
  const parsed: unknown = await parseAsync(bytes, settings);
  const model = parsed as {
    documentPart?: { body?: unknown };
    stylesPart?: { styles?: unknown };
    parts?: unknown;
  } | null;
  adjustPageBreaks(model?.documentPart?.body, options.savedPageBreaks, breakBeforeStyles(model?.stylesPart?.styles));
  unwrapNoteReferenceRuns(model?.documentPart?.body);
  inheritHeadersAndFooters(model?.documentPart?.body);
  const numbering = tagPageNumbers(model?.documentPart?.body, model?.parts);
  const nodes = await renderDocument(parsed, settings);
  styles.replaceChildren();
  body.replaceChildren();
  for (const node of nodes) (node.nodeName === "STYLE" ? styles : body).append(node);
  const sheets = Array.from(body.querySelectorAll<HTMLElement>(`.${PREVIEW_WRAPPER} > section.${PREVIEW_CLASS}`));
  numberPageFields(sheets, numbering);
  return sheets;
}

/** The parts of docx-preview's parsed document model that page grouping looks at. */
interface ModelNode {
  type?: string;
  children?: ModelNode[];
  break?: string;
  text?: string;
  sectionProps?: { type?: string } | null;
  pageBreakBefore?: boolean;
  styleName?: string;
  verticalAlign?: string;
  props?: { type?: string };
  className?: string;
  fieldRun?: boolean;
  charType?: string;
  rootElement?: ModelNode;
}

type HeaderRef = { type?: string; id?: string };
type SectionModel = {
  type?: string;
  headerRefs?: HeaderRef[];
  footerRefs?: HeaderRef[];
  pageNumber?: { start?: unknown; format?: unknown } | null;
};

/** Section properties of a parsed body in document order: the ones closing paragraphs, then the body's. */
function sectionsOf(body: ModelNode): SectionModel[] {
  return [
    ...(body.children ?? [])
      .filter(isNode)
      .flatMap((b) => (b.type === "paragraph" && isNode(b.sectionProps) ? [b.sectionProps] : [])),
    ...(isNode(body.props) ? [body.props] : []),
  ] as SectionModel[];
}

/**
 * Word sections without their own header or footer of a kind (default, first, even) continue the
 * previous section's ("link to previous"); docx-preview leaves them empty. Copies the references
 * forward in the parsed model (in place).
 */
export function inheritHeadersAndFooters(body: unknown): void {
  if (!isNode(body) || !Array.isArray(body.children)) return;
  const sections = sectionsOf(body);
  for (const key of ["headerRefs", "footerRefs"] as const) {
    let previous: HeaderRef[] = [];
    for (const section of sections) {
      const own = Array.isArray(section[key]) ? section[key].filter(isNode) : [];
      const merged = [...previous.filter((p) => !own.some((o) => o.type === p.type)), ...own];
      if (merged.length > 0) section[key] = merged;
      previous = merged;
    }
  }
}

const NOTE_REFERENCES = new Set(["footnoteReference", "endnoteReference"]);
const MAX_MODEL_DEPTH = 64;

/**
 * docx-preview renders the children of a run with direct superscript/subscript formatting twice and
 * keeps the second copy; a footnote or endnote reference in such a run is then counted twice (wrong
 * number, duplicated note). The reference is rendered as superscript anyway, so the run's vertical
 * alignment is dropped (in place).
 */
export function unwrapNoteReferenceRuns(node: unknown, depth = 0): void {
  if (!isNode(node) || !Array.isArray(node.children) || depth > MAX_MODEL_DEPTH) return;
  for (const child of node.children) {
    if (!isNode(child)) continue;
    if (
      child.type === "run" &&
      child.verticalAlign &&
      child.children?.some((c) => isNode(c) && NOTE_REFERENCES.has(c.type ?? ""))
    ) {
      delete child.verticalAlign;
    }
    unwrapNoteReferenceRuns(child, depth + 1);
  }
}

/** Class on the saved result of a PAGE field; {@link numberPageFields} writes the sheet's number into it. */
export const PAGE_FIELD_CLASS = `${PREVIEW_CLASS}-page-field`;
/** Class on the saved result of a NUMPAGES field; {@link numberPageFields} writes the sheet count into it. */
export const NUMPAGES_FIELD_CLASS = `${PREVIEW_CLASS}-numpages-field`;
/** Class prefix on the first block of a section that starts on a new sheet, followed by the section index. */
export const SECTION_START_CLASS = `${PREVIEW_CLASS}-section-`;

const FIELD_CLASSES: Record<string, string> = { PAGE: PAGE_FIELD_CLASS, NUMPAGES: NUMPAGES_FIELD_CLASS };

/** Page numbering of one section (`w:pgNumType`): restart value and number format, when set. */
export interface SectionNumbering {
  start?: number;
  format?: string;
}

/**
 * docx-preview shows the result Word saved for a field, so a PAGE field reads the same on every sheet.
 * Prepares the parsed model (in place) for {@link numberPageFields}:
 *  - the first saved-result run of every PAGE and NUMPAGES field in the body, headers and footers gets
 *    a class; further result runs of the same field are emptied;
 *  - the first block of every section that starts on a new sheet gets a class with the section index.
 * Returns each section's page numbering, by section index.
 */
export function tagPageNumbers(body: unknown, parts: unknown): SectionNumbering[] {
  const roots = Array.isArray(parts)
    ? parts.flatMap((p) => (isNode(p) && isNode(p.rootElement) ? [p.rootElement] : []))
    : [];
  for (const root of [body, ...roots]) tagFieldResults(root);
  if (!isNode(body) || !Array.isArray(body.children)) return [];
  const sections = sectionsOf(body);
  let index = 0;
  let opens = true;
  for (const block of body.children) {
    if (!isNode(block)) continue;
    if (opens && (index === 0 || !NO_PAGE_SECTIONS.has(sections[index]?.type ?? ""))) {
      block.className = [block.className, `${SECTION_START_CLASS}${index}`].filter(Boolean).join(" ");
    }
    opens = block.type === "paragraph" && isNode(block.sectionProps);
    if (opens) index++;
  }
  return sections.map((s) => {
    const start = s.pageNumber?.start;
    const format = s.pageNumber?.format;
    return {
      start: typeof start === "number" && Number.isFinite(start) ? start : undefined,
      format: typeof format === "string" && format ? format : undefined,
    };
  });
}

/** Tags the saved results of PAGE and NUMPAGES fields under `root` (complex fields, nesting allowed). */
function tagFieldResults(root: unknown): void {
  const open: { code: string; result: boolean; tagged: boolean }[] = [];
  const visit = (node: ModelNode, depth: number): void => {
    if (depth > MAX_MODEL_DEPTH || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (!isNode(child)) continue;
      if (child.type === "run" && child.fieldRun) {
        for (const item of child.children ?? []) {
          const field = open.at(-1);
          if (item.type === "complexField" && item.charType === "begin")
            open.push({ code: "", result: false, tagged: false });
          else if (item.type === "complexField" && item.charType === "separate" && field) field.result = true;
          else if (item.type === "complexField" && item.charType === "end") open.pop();
          else if (item.type === "instruction" && field && !field.result) field.code += item.text ?? "";
        }
        continue;
      }
      const field = open.at(-1);
      const fieldClass = field?.result
        ? FIELD_CLASSES[field.code.trim().split(/\s+/)[0]?.toUpperCase() ?? ""]
        : undefined;
      if (child.type === "run" && field && fieldClass) {
        if (field.tagged) child.children = [];
        else child.className = [child.className, fieldClass].filter(Boolean).join(" ");
        field.tagged = true;
        continue;
      }
      visit(child, depth + 1);
    }
  };
  if (isNode(root)) visit(root, 0);
}

/**
 * Writes page numbers into the PAGE and NUMPAGES results tagged by {@link tagPageNumbers}. Sheets count
 * up from 1; a section that starts on a new sheet restarts at its `start` and switches to its format.
 * Numbers follow the sheets, so they match Word's pages as far as the sheets do (see Pagination).
 */
export function numberPageFields(sheets: readonly HTMLElement[], sections: readonly SectionNumbering[]): void {
  const seen = new Set<number>();
  let format: string | undefined;
  let page = 0;
  for (const sheet of sheets) {
    let opened: number | undefined;
    for (const el of Array.from(sheet.querySelectorAll(`[class*="${SECTION_START_CLASS}"]`))) {
      for (const name of Array.from(el.classList)) {
        if (!name.startsWith(SECTION_START_CLASS)) continue;
        const index = Number(name.slice(SECTION_START_CLASS.length));
        // A paragraph split at a page break keeps its classes on both halves; only the first counts.
        if (Number.isInteger(index) && !seen.has(index)) {
          seen.add(index);
          opened ??= index;
        }
      }
    }
    const section = opened === undefined ? undefined : sections[opened];
    if (opened !== undefined) format = section?.format;
    page = section?.start ?? page + 1;
    const text = formatPageNumber(page, format);
    for (const el of Array.from(sheet.querySelectorAll(`.${PAGE_FIELD_CLASS}`))) el.textContent = text;
    for (const el of Array.from(sheet.querySelectorAll(`.${NUMPAGES_FIELD_CLASS}`))) {
      el.textContent = String(sheets.length);
    }
  }
}

/** A page number in a Word number format (`w:pgNumType w:fmt`); unknown formats are decimal. */
function formatPageNumber(n: number, format: string | undefined): string {
  switch (format) {
    case "lowerRoman":
      return roman(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "lowerLetter":
      return wordLetters(n);
    case "upperLetter":
      return wordLetters(n).toUpperCase();
    case "chineseCounting":
    case "chineseCountingThousand":
      return chineseCounting(n);
    default:
      return String(n);
  }
}

/** Ids of paragraph styles with "page break before", following w:basedOn, from docx-preview's parsed styles. */
function breakBeforeStyles(styles: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(styles)) return out;
  type Style = { id?: string; basedOn?: string; paragraphProps?: { pageBreakBefore?: boolean } };
  const byId = new Map<string, Style>();
  for (const style of styles as Style[]) if (isNode(style) && typeof style.id === "string") byId.set(style.id, style);
  for (const id of byId.keys()) {
    let current: Style | undefined = byId.get(id);
    for (let hops = 0; current && hops < 32; hops++) {
      if (current.paragraphProps?.pageBreakBefore) {
        out.add(id);
        break;
      }
      current = current.basedOn ? byId.get(current.basedOn) : undefined;
    }
  }
  return out;
}

const SAVED_BREAK = "lastRenderedPageBreak";
const NO_PAGE_SECTIONS = new Set(["continuous", "nextColumn"]);

function isNode(value: unknown): value is ModelNode {
  return typeof value === "object" && value !== null;
}

function runsOf(p: ModelNode): ModelNode[] {
  return Array.isArray(p.children) ? p.children.filter(isNode) : [];
}

/** The saved page break that opens a paragraph (before any text, tab or picture), with its run. */
function leadingSavedBreak(p: ModelNode): { run: ModelNode; item: ModelNode } | null {
  for (const run of runsOf(p)) {
    if (run.type !== "run") {
      if (run.type === "bookmarkStart" || run.type === "bookmarkEnd") continue;
      return null;
    }
    for (const item of run.children ?? []) {
      if (item.type === "break" && item.break === SAVED_BREAK) return { run, item };
      if (item.type === "text" && !item.text) continue;
      return null;
    }
  }
  return null;
}

/** True when the last content of a paragraph is an explicit page break. */
function endsWithPageBreak(p: ModelNode): boolean {
  let last: ModelNode | undefined;
  for (const run of runsOf(p)) {
    for (const item of run.children ?? []) if (!(item.type === "text" && !item.text)) last = item;
  }
  return last?.type === "break" && last.break === "page";
}

/**
 * Adjusts docx-preview's parsed body (in place) so that its page grouping yields one sheet per
 * section start and explicit break:
 *  - a page break is appended to the last paragraph of every section the next section starts on a new
 *    page (docx-preview otherwise only starts a sheet when the page size changes, and one section late);
 *  - saved page breaks (`w:lastRenderedPageBreak`) that open a page which already starts anyway (after
 *    an explicit or section break, or with "page break before" on the paragraph or its style) are
 *    dropped, as they would leave an empty sheet; with `savedPageBreaks` false all of them are dropped.
 * Only top-level paragraphs matter: docx-preview never splits sheets inside tables.
 */
export function adjustPageBreaks(
  body: unknown,
  savedPageBreaks: boolean,
  breakBefore: ReadonlySet<string> = new Set(),
): void {
  if (!isNode(body) || !Array.isArray(body.children)) return;
  const blocks = body.children.filter(isNode);
  const ends = blocks.filter((b) => b.type === "paragraph" && b.sectionProps);
  const breakAfter = new Set<ModelNode>();
  ends.forEach((p, i) => {
    const next = i + 1 < ends.length ? ends[i + 1].sectionProps : body.props;
    if (!NO_PAGE_SECTIONS.has(next?.type ?? "")) breakAfter.add(p);
  });
  let pageStarts = true;
  for (const block of blocks) {
    if (block.type !== "paragraph") {
      pageStarts = false;
      continue;
    }
    for (const run of runsOf(block)) {
      if (run.type !== "run" || !Array.isArray(run.children)) continue;
      if (!savedPageBreaks) run.children = run.children.filter((c) => !(c.type === "break" && c.break === SAVED_BREAK));
    }
    const breaksBefore =
      block.pageBreakBefore === true || (block.styleName !== undefined && breakBefore.has(block.styleName));
    if (savedPageBreaks && (pageStarts || breaksBefore)) {
      const leading = leadingSavedBreak(block);
      if (leading?.run.children) leading.run.children = leading.run.children.filter((c) => c !== leading.item);
    }
    if (breakAfter.has(block)) {
      block.children = [...runsOf(block), { type: "run", children: [{ type: "break", break: "page" }] }];
    }
    const hasContent = runsOf(block).some((r) => (r.children ?? []).some((c) => !(c.type === "text" && !c.text)));
    pageStarts = breakAfter.has(block) || endsWithPageBreak(block) || (pageStarts && !hasContent);
  }
}

/** docx-preview's class for a paragraph style id (it lower-cases and replaces spaces, dots and ampersands). */
export function styleClass(styleId: string): string {
  return `${PREVIEW_CLASS}_${styleId.replace(/[ .]+/g, "-").replace(/[&]+/g, "and").toLowerCase()}`;
}

/**
 * Gives heading paragraphs (docx-preview renders every paragraph as `<p>`) the ARIA heading role and
 * level, so snapshots classify them as headings. Returns the text of the first heading, for the title.
 */
export function markHeadings(root: HTMLElement, headings: ReadonlyMap<string, HeadingStyle>): string | undefined {
  const byClass = new Map<string, HeadingStyle>();
  for (const [id, style] of headings) byClass.set(styleClass(id), style);
  if (byClass.size === 0) return undefined;
  let first: string | undefined;
  for (const p of Array.from(root.querySelectorAll("p[class]"))) {
    const style = Array.from(p.classList, (c) => byClass.get(c)).find((s) => s !== undefined);
    if (!style) continue;
    p.setAttribute("role", "heading");
    p.setAttribute("aria-level", String(style.level));
    first ??= p.textContent?.trim() || undefined;
  }
  return first;
}

const UNIT_PX: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

/** A plain CSS length ("612pt", "8.5in", "816px") in px, or null for anything else (calc(), %, empty). */
export function lengthPx(value: string): number | null {
  const match = /^\s*(-?\d*\.?\d+)(px|pt|pc|in|cm|mm)\s*$/i.exec(value);
  if (!match) return null;
  return Number(match[1]) * UNIT_PX[match[2].toLowerCase()];
}

/** Smallest side margin kept when a sheet is narrowed, px. */
const MIN_SIDE_MARGIN = 12;

/**
 * Narrows sheets that are wider than the layout allows: the sheet takes the available width, side
 * margins shrink in proportion (never below 12 px) and the minimum height keeps the page's aspect
 * ratio. Text reflows inside; nothing is scaled, so text stays crisp and selectable.
 */
export function fitSheets(pages: readonly HTMLElement[], width: number): void {
  const avail = availableSheetWidth(width);
  for (const page of pages) {
    const w = lengthPx(page.style.width);
    if (w === null || w <= avail) continue;
    const scale = avail / w;
    page.style.width = `${round(avail)}px`;
    for (const side of ["padding-left", "padding-right"] as const) {
      const v = lengthPx(page.style.getPropertyValue(side));
      if (v !== null) page.style.setProperty(side, `${round(Math.max(Math.min(MIN_SIDE_MARGIN, v), v * scale))}px`);
    }
    const minHeight = lengthPx(page.style.minHeight);
    if (minHeight !== null) page.style.minHeight = `${round(minHeight * scale)}px`;
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * True when some sheet grew well past its page height: the content between two breaks is longer than a
 * page, which is where Word would have started a new page automatically.
 */
export function hasOverfullSheets(pages: readonly HTMLElement[]): boolean {
  return pages.some((page) => {
    const minHeight = lengthPx(page.style.minHeight);
    return minHeight !== null && minHeight > 0 && page.getBoundingClientRect().height > minHeight * 1.1;
  });
}
