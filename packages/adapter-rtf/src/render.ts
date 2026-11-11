import {
  type AssetUrls,
  type ContentBudget,
  cleanText,
  escapeHtml,
  type FontReport,
  imageSize,
  openSheet,
  px,
  type SheetRender,
  type SheetSpec,
} from "@swarmloom/adapter-odf/kit";
import type { RtfCell, RtfCharStyle, RtfDocument, RtfFont, RtfParagraph, RtfRun, RtfTable } from "./model";

/** Pixels per twip at 96 dpi. */
const PX = 1 / 15;

/** Inputs of {@link renderRtf}. */
export interface RtfRenderOptions {
  fonts: FontReport;
  assets: AssetUrls;
  budget: ContentBudget;
}

/** Sheets of an RTF document, plus what could not be shown. */
export interface RtfRender extends SheetRender {
  stats: { missingImages: number };
}

interface Context extends RtfRenderOptions {
  defaultFont?: RtfFont;
  missingImages: number;
}

function runCss(s: RtfCharStyle, cx: Context): string {
  const css: string[] = [];
  if (s.font && s.font !== cx.defaultFont && s.font.name)
    css.push(`font-family:${cx.fonts.use(s.font.name, s.font.generic)}`);
  const size = s.vertical ? s.size * 0.65 : s.size;
  if (size !== 24) css.push(`font-size:${(size / 2).toFixed(1).replace(/\.0$/, "")}pt`);
  if (s.bold) css.push("font-weight:700");
  if (s.italic) css.push("font-style:italic");
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter((d) => d).join(" ");
  if (deco) css.push(`text-decoration-line:${deco}`);
  if (s.color) css.push(`color:${s.color}`);
  if (s.background) css.push(`background-color:${s.background}`);
  if (s.vertical) css.push(`vertical-align:${s.vertical}`);
  if (s.caps === "all") css.push("text-transform:uppercase");
  else if (s.caps === "small") css.push("font-variant:small-caps");
  return css.join(";");
}

function imageHtml(run: Extract<RtfRun, { type: "image" }>, cx: Context): string {
  const url = cx.assets.image(run.bytes);
  if (!url) {
    cx.missingImages++;
    return "";
  }
  const natural = imageSize(run.bytes);
  let w = run.width !== undefined ? run.width * PX : natural?.w;
  let h = run.height !== undefined ? run.height * PX : natural?.h;
  if (w !== undefined && h === undefined && natural) h = (w * natural.h) / natural.w;
  if (h !== undefined && w === undefined && natural) w = (h * natural.w) / natural.h;
  const size = w !== undefined && h !== undefined ? ` style="width:${px(w)};height:${px(h)}"` : "";
  return `<img src="${escapeHtml(url)}" alt=""${size}>`;
}

function runsHtml(runs: readonly RtfRun[], cx: Context): string {
  let out = "";
  let open = "";
  let text = "";
  const close = () => {
    if (text) out += open ? `<span style="${escapeHtml(open)}">${escapeHtml(text)}</span>` : escapeHtml(text);
    text = "";
  };
  for (const run of runs) {
    if (run.type === "text") {
      const css = runCss(run.style, cx);
      if (css !== open) {
        close();
        open = css;
      }
      text += cleanText(run.text);
      continue;
    }
    close();
    if (run.type === "break") out += "<br>";
    else if (run.type === "tab") out += "\t";
    else if (run.type === "image") out += imageHtml(run, cx);
    else {
      const w = run.width !== undefined ? run.width * PX : 96;
      const h = run.height !== undefined ? run.height * PX : 72;
      out += `<span class="rtf-pict" style="width:${px(Math.min(w, 1200))};height:${px(Math.min(h, 1600))}">${escapeHtml(run.format.toUpperCase())} picture</span>`;
    }
  }
  close();
  return out;
}

function paragraphText(p: RtfParagraph): number {
  let n = 0;
  for (const r of p.runs) if (r.type === "text") n += r.text.trim().length;
  return n;
}

function paragraphHtml(p: RtfParagraph, cx: Context): string {
  const css: string[] = [];
  if (p.align !== "left") css.push(`text-align:${p.align}`);
  if (p.leftIndent) css.push(`margin-left:${px(p.leftIndent * PX)}`);
  if (p.rightIndent) css.push(`margin-right:${px(p.rightIndent * PX)}`);
  if (p.firstIndent) css.push(`text-indent:${px(p.firstIndent * PX)}`);
  if (p.spaceBefore) css.push(`margin-top:${px(p.spaceBefore * PX)}`);
  if (p.spaceAfter) css.push(`margin-bottom:${px(p.spaceAfter * PX)}`);
  if (p.lineSpacing !== undefined) {
    if (p.lineMultiple) css.push(`line-height:${((p.lineSpacing / 240) * 1.2).toFixed(3)}`);
    else css.push(`line-height:${px(Math.abs(p.lineSpacing) * PX)}`);
  }
  if (p.markSize !== 24 && p.markSize > 0) css.push(`font-size:${p.markSize / 2}pt`);
  const inner = runsHtml(p.runs, cx);
  return `<p${css.length ? ` style="${css.join(";")}"` : ""}>${inner || "<br>"}</p>`;
}

interface GridCell {
  cell: RtfCell;
  bordered: boolean;
  colspan: number;
  rowspan: number;
}

function tableHtml(table: RtfTable, cx: Context): string {
  const edges = [...new Set(table.rows.flatMap((r) => [r.left, ...r.cells.map((c) => c.right)]))].sort((a, b) => a - b);
  const index = (x: number) => edges.indexOf(x);
  const rows: (GridCell | { gap: number })[][] = [];
  const owners = new Map<string, GridCell>();
  for (const row of table.rows) {
    if (
      !cx.budget.take(
        row.cells.reduce((n, c) => n + c.paragraphs.reduce((m, p) => m + paragraphText(p), 0), 0),
        row.cells.length,
      )
    )
      continue;
    const out: (GridCell | { gap: number })[] = [];
    let prev = row.left;
    if (index(prev) > 0) out.push({ gap: index(prev) });
    let last: GridCell | undefined;
    for (const cell of row.cells) {
      const start = index(prev);
      const end = index(cell.right);
      prev = cell.right;
      const span = Math.max(1, end - start);
      const key = `${start}:${end}`;
      if (cell.mergedLeft && last) {
        last.colspan += span;
        continue;
      }
      if (cell.verticalMerge === "continue") {
        const owner = owners.get(key);
        if (owner) {
          owner.rowspan++;
          continue;
        }
      }
      last = { cell, bordered: row.bordered, colspan: span, rowspan: 1 };
      if (cell.verticalMerge === "first") owners.set(key, last);
      else owners.delete(key);
      out.push(last);
    }
    rows.push(out);
  }
  if (rows.length === 0) return "";
  const cols = edges
    .slice(1)
    .map((e, i) => `<col style="width:${px((e - (edges[i] as number)) * PX)}">`)
    .join("");
  const width = ((edges[edges.length - 1] as number) - (edges[0] as number)) * PX;
  const body = rows
    .map((row) => {
      const cells = row
        .map((c) => {
          if ("gap" in c) return `<td class="rtf-gap" colspan="${c.gap}"></td>`;
          const span = `${c.colspan > 1 ? ` colspan="${c.colspan}"` : ""}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ""}`;
          const bg = c.cell.background ? ` style="background-color:${c.cell.background}"` : "";
          const cls = c.bordered ? ` class="rtf-b"` : "";
          return `<td${cls}${span}${bg}>${c.cell.paragraphs.map((p) => paragraphHtml(p, cx)).join("")}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const left = (edges[0] as number) * PX;
  return `<table style="width:${px(width)};margin-left:${px(left)}"><colgroup>${cols}</colgroup><tbody>${body}</tbody></table>`;
}

/**
 * Renders a parsed RTF document as page sheets: one sheet per explicit page break, at the paper
 * size and margins of the document, within the long-input budget.
 */
export function renderRtf(doc: RtfDocument, options: RtfRenderOptions): RtfRender {
  const cx: Context = { ...options, missingImages: 0 };
  if (doc.defaultFont) cx.defaultFont = doc.defaultFont;
  const page = doc.page;
  const w = Math.max(240, Math.min(2400, page.width * PX));
  const h = Math.max(240, Math.min(3200, page.height * PX));
  const side = (v: number) => Math.max(0, Math.min(v * PX, w / 3));
  const padding = `padding:${px(side(page.top))} ${px(side(page.right))} ${px(side(page.bottom))} ${px(side(page.left))};`;
  const pages: string[][] = [[]];
  for (const block of doc.blocks) {
    if (block.type === "page-break") {
      if ((pages[pages.length - 1] as string[]).length > 0) pages.push([]);
      continue;
    }
    let html = "";
    if (block.type === "table") html = tableHtml(block, cx);
    else if (options.budget.take(paragraphText(block))) html = paragraphHtml(block, cx);
    if (html) (pages[pages.length - 1] as string[]).push(html);
  }
  const filled = pages.filter((p) => p.length > 0);
  if (filled.length === 0) filled.push([]);
  const sheets: SheetSpec[] = filled.map(() => ({ w, h }));
  const html = filled
    .map((p) => `${openSheet({ w, h }, { className: "rtf", style: padding })}${p.join("")}</section>`)
    .join("");
  const family = doc.defaultFont?.name
    ? options.fonts.use(doc.defaultFont.name, doc.defaultFont.generic)
    : options.fonts.use("Times New Roman");
  const tab = Math.max(8, doc.defaultTab * PX);
  const css = [
    `.rtf{color:#000;font-size:12pt;line-height:1.2;font-family:${family};}`,
    `.rtf p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:${px(tab)};}`,
    ".rtf img{max-width:100%;vertical-align:baseline;}",
    ".rtf table{border-collapse:collapse;table-layout:fixed;margin-top:2px;margin-bottom:2px;}",
    ".rtf td{vertical-align:top;padding:1px 7px;}",
    ".rtf td.rtf-b{border:1px solid #000;}",
    ".rtf .rtf-pict{display:inline-flex;align-items:center;justify-content:center;border:1px dashed #9aa0aa;color:#6b7280;",
    "font:9pt/1.2 sans-serif;background:#f6f7f9;vertical-align:bottom;text-indent:0;}",
  ].join("");
  return { html, css, sheets, role: "page", stats: { missingImages: cx.missingImages } };
}
