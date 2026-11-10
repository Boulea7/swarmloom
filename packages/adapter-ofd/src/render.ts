import {
  type AssetUrls,
  type ContentBudget,
  cleanText,
  DocumentError,
  escapeHtml,
  type FontReport,
  kid,
  kids,
  openSheet,
  parseXml,
  px,
  type SheetRender,
  type SheetSpec,
} from "@swarmloom/adapter-odf/kit";
import { type MmBox, type OfdPackage, parseBox } from "./package";
import { abbreviatedToSvg } from "./path";

/** CSS pixels per millimetre (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
const K = PX_PER_MM;
/** Baseline position as a share of the font size, for placing text by its baseline. */
const ASCENT = 0.88;
const MAX_OBJECTS_PER_PAGE = 4000;
const MAX_GLYPHS_PER_CODE = 4000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

/** Inputs of {@link renderOfd}. */
export interface OfdRenderOptions {
  win: object | null;
  fonts: FontReport;
  assets: AssetUrls;
  budget: ContentBudget;
  /** Most pages rendered. */
  maxPages: number;
}

/** Counters reported as quality notes. */
export interface OfdStats {
  composite: number;
  missingImages: number;
  objectsCut: number;
  embeddedFonts: number;
}

/** Sheets of an OFD document. */
export interface OfdRender extends SheetRender {
  stats: OfdStats;
}

interface Context extends OfdRenderOptions {
  pkg: OfdPackage;
  stats: OfdStats;
  objects: number;
}

type Matrix = [number, number, number, number, number, number];

const n = (v: number) => String(Math.round(v * 1000) / 1000);

/** Parses "a b c d e f". */
export function parseMatrix(value: string | null | undefined): Matrix | undefined {
  const m = (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return m.length === 6 && m.every(Number.isFinite) ? (m as Matrix) : undefined;
}

/** OFD colour (`Value="r g b"` 0-255, or `#rrggbb`) as CSS, with `Alpha` (0-255) as opacity. */
export function ofdColor(el: Element | undefined): { color: string; opacity?: number } | undefined {
  if (!el) return undefined;
  const value = (el.getAttribute("Value") ?? "").trim();
  let color: string | undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) color = value.toLowerCase();
  else {
    const c = value.split(/\s+/).map(Number);
    if (c.length >= 3 && c.slice(0, 3).every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      color = `#${c
        .slice(0, 3)
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")}`;
    }
  }
  if (!color) return undefined;
  const alpha = Number(el.getAttribute("Alpha"));
  return el.hasAttribute("Alpha") && Number.isFinite(alpha) && alpha >= 0 && alpha < 255
    ? { color, opacity: alpha / 255 }
    : { color };
}

/** Expands a DeltaX/DeltaY list, including the `g N v` repeat form. */
export function parseDeltas(value: string | null | undefined, max = MAX_GLYPHS_PER_CODE): number[] {
  const tokens = (value ?? "")
    .trim()
    .split(/\s+/)
    .filter((t) => t);
  const out: number[] = [];
  for (let i = 0; i < tokens.length && out.length < max; i++) {
    if (tokens[i] === "g") {
      const count = Math.min(Number(tokens[i + 1]), max - out.length);
      const v = Number(tokens[i + 2]);
      i += 2;
      if (Number.isInteger(count) && count > 0 && Number.isFinite(v)) for (let k = 0; k < count; k++) out.push(v);
      continue;
    }
    const v = Number(tokens[i]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function placement(box: MmBox, ctm: Matrix | undefined): string {
  const t = ctm
    ? `transform:matrix(${n(ctm[0])},${n(ctm[1])},${n(ctm[2])},${n(ctm[3])},${n(ctm[4] * K)},${n(ctm[5] * K)});`
    : "";
  return `left:${px(box.x * K)};top:${px(box.y * K)};width:${px(box.w * K)};height:${px(box.h * K)};${t}`;
}

function glyphs(chars: string[], dx: number[], dy: number[], size: number): string {
  const esc = (c: string) => escapeHtml(c);
  if (dx.length === 0 && dy.length === 0) return esc(chars.join(""));
  if (dx.length === 0) {
    // Vertical text: one glyph per line box, each DeltaY below the previous.
    let y = 0;
    return chars
      .map((c, i) => {
        const out = `<span class="ofd-v" style="top:${px(y * K)}">${esc(c)}</span>`;
        y += dy[i] ?? size;
        return out;
      })
      .join("");
  }
  if (dy.length > 0) {
    let x = 0;
    let y = 0;
    return chars
      .map((c, i) => {
        const out = `<span class="ofd-v" style="left:${px(x * K)};top:${px(y * K)}">${esc(c)}</span>`;
        x += dx[i] ?? 0;
        y += dy[i] ?? 0;
        return out;
      })
      .join("");
  }
  // Horizontal text with explicit advances: each glyph box is exactly DeltaX wide.
  return chars
    .map((c, i) =>
      i < dx.length ? `<span class="ofd-g" style="width:${px((dx[i] as number) * K)}">${esc(c)}</span>` : esc(c),
    )
    .join("");
}

function textObject(el: Element, cx: Context): string {
  const box = parseBox(el.getAttribute("Boundary"));
  if (!box) return "";
  const sizeAttr = Number(el.getAttribute("Size"));
  const size = Number.isFinite(sizeAttr) && sizeAttr > 0 && sizeAttr < 500 ? sizeAttr : 3.528;
  const font = cx.pkg.fonts.get(el.getAttribute("Font") ?? "");
  const names = font ? [font.name, ...(font.family && font.family !== font.name ? [font.family] : [])] : ["SimSun"];
  const css = [placement(box, parseMatrix(el.getAttribute("CTM")))];
  css.push(`font-family:${cx.fonts.useAll(names)};font-size:${px(size * K)};line-height:${px(size * K)};`);
  const weight = Number(el.getAttribute("Weight"));
  if ((Number.isFinite(weight) && weight >= 600) || font?.bold) css.push("font-weight:700;");
  if (el.getAttribute("Italic") === "true" || font?.italic) css.push("font-style:italic;");
  const fill =
    el.getAttribute("Fill") === "false" ? undefined : (ofdColor(kid(el, null, "FillColor")) ?? { color: "#000000" });
  css.push(fill ? `color:${fill.color};` : "color:transparent;");
  if (fill?.opacity !== undefined) css.push(`opacity:${n(fill.opacity)};`);
  let chars = 0;
  const runs = kids(el, null, "TextCode")
    .map((tc) => {
      const text = [...cleanText(tc.textContent ?? "").replace(/[\r\n]+/g, "")].slice(0, MAX_GLYPHS_PER_CODE);
      if (text.length === 0) return "";
      chars += text.length;
      const x = Number(tc.getAttribute("X")) || 0;
      const y = Number(tc.getAttribute("Y")) || 0;
      const inner = glyphs(text, parseDeltas(tc.getAttribute("DeltaX")), parseDeltas(tc.getAttribute("DeltaY")), size);
      return `<span class="ofd-run" style="left:${px(x * K)};top:${px((y - ASCENT * size) * K)}">${inner}</span>`;
    })
    .join("");
  if (!runs) return "";
  cx.budget.take(chars);
  // Font stacks carry quotes: the attribute value is escaped as a whole.
  return `<div class="ofd-t" style="${escapeHtml(css.join(""))}">${runs}</div>`;
}

const CAPS: Record<string, string> = { Butt: "butt", Round: "round", Square: "square" };
const JOINS: Record<string, string> = { Miter: "miter", Round: "round", Bevel: "bevel" };

function pathObject(el: Element, cx: Context): string {
  const box = parseBox(el.getAttribute("Boundary"));
  const d = abbreviatedToSvg(kid(el, null, "AbbreviatedData")?.textContent ?? "");
  if (!box || !d) return "";
  const stroke = el.getAttribute("Stroke") !== "false";
  const fill = el.getAttribute("Fill") === "true";
  if (!stroke && !fill) return "";
  const width = Number(el.getAttribute("LineWidth"));
  const attrs: string[] = [`d="${d}"`];
  const fc = ofdColor(kid(el, null, "FillColor")) ?? { color: "#000000" };
  const sc = ofdColor(kid(el, null, "StrokeColor")) ?? { color: "#000000" };
  attrs.push(fill ? `fill="${fc.color}"` : `fill="none"`);
  if (fill && fc.opacity !== undefined) attrs.push(`fill-opacity="${n(fc.opacity)}"`);
  if (fill && el.getAttribute("Rule") === "Even-Odd") attrs.push(`fill-rule="evenodd"`);
  if (stroke) {
    attrs.push(`stroke="${sc.color}"`, `stroke-width="${n(Number.isFinite(width) && width > 0 ? width : 0.353)}"`);
    if (sc.opacity !== undefined) attrs.push(`stroke-opacity="${n(sc.opacity)}"`);
    const cap = CAPS[el.getAttribute("Cap") ?? ""];
    const join = JOINS[el.getAttribute("Join") ?? ""];
    if (cap) attrs.push(`stroke-linecap="${cap}"`);
    if (join) attrs.push(`stroke-linejoin="${join}"`);
    const dash = (el.getAttribute("DashPattern") ?? "").trim().split(/\s+/).map(Number);
    if (dash.length >= 2 && dash.every((v) => Number.isFinite(v) && v >= 0))
      attrs.push(`stroke-dasharray="${dash.map(n).join(" ")}"`);
  }
  const ctm = parseMatrix(el.getAttribute("CTM"));
  if (ctm) attrs.push(`transform="matrix(${ctm.map(n).join(" ")})"`);
  cx.budget.take(0);
  const pos = `left:${px(box.x * K)};top:${px(box.y * K)};width:${px(box.w * K)};height:${px(box.h * K)}`;
  return `<svg class="ofd-p" xmlns="http://www.w3.org/2000/svg" style="${pos}" viewBox="0 0 ${n(box.w)} ${n(box.h)}" preserveAspectRatio="none" overflow="visible"><path ${attrs.join(" ")}/></svg>`;
}

function imageObject(el: Element, cx: Context): string {
  const box = parseBox(el.getAttribute("Boundary"));
  if (!box) return "";
  const path = cx.pkg.media.get(el.getAttribute("ResourceID") ?? "");
  const zip = cx.pkg.zip;
  const url =
    path && zip.has(path) && (zip.size(path) ?? 0) <= MAX_IMAGE_BYTES ? cx.assets.image(zip.read(path), path) : null;
  if (!url) {
    cx.stats.missingImages++;
    return "";
  }
  cx.budget.take(0);
  const ctm = parseMatrix(el.getAttribute("CTM")) ?? [box.w, 0, 0, box.h, 0, 0];
  const [a, b, c, d, e, f] = ctm;
  const src = escapeHtml(url);
  if (b === 0 && c === 0 && a > 0 && d > 0) {
    // The usual case: the unit image square scaled to (a x d) mm at (e, f) inside the boundary.
    const pos = `left:${px((box.x + e) * K)};top:${px((box.y + f) * K)};width:${px(a * K)};height:${px(d * K)}`;
    return `<img class="ofd-i" src="${src}" alt="" style="${pos}">`;
  }
  const t = `transform:matrix(${n(a * K)},${n(b * K)},${n(c * K)},${n(d * K)},${n(e * K)},${n(f * K)})`;
  return `<div class="ofd-o" style="left:${px(box.x * K)};top:${px(box.y * K)}"><img class="ofd-u" src="${src}" alt="" style="${t}"></div>`;
}

function objects(container: Element, cx: Context, depth: number): string {
  let out = "";
  for (const el of kids(container)) {
    if (cx.objects >= MAX_OBJECTS_PER_PAGE) {
      cx.stats.objectsCut++;
      break;
    }
    switch (el.localName) {
      case "TextObject":
        cx.objects++;
        out += textObject(el, cx);
        break;
      case "PathObject":
        cx.objects++;
        out += pathObject(el, cx);
        break;
      case "ImageObject":
        cx.objects++;
        out += imageObject(el, cx);
        break;
      case "PageBlock":
        if (depth < 16) out += objects(el, cx, depth + 1);
        break;
      case "CompositeObject":
        cx.stats.composite++;
        break;
      default:
        break;
    }
  }
  return out;
}

const LAYER_ORDER: Record<string, number> = { Background: 0, Body: 1, Foreground: 2 };

/** Objects of a page or template content part, layer by layer (background, body, foreground). */
function contentHtml(root: Element, cx: Context): string {
  const layers = kids(kid(root, null, "Content") ?? root, null, "Layer");
  return layers
    .map((layer, i) => ({ layer, i, order: LAYER_ORDER[layer.getAttribute("Type") ?? "Body"] ?? 1 }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ layer }) => objects(layer, cx, 0))
    .join("");
}

function part(cx: Context, path: string): Element {
  return parseXml(cx.pkg.zip.text(path), { format: "ofd", part: path, window: cx.win }).documentElement;
}

/**
 * Renders the pages of an OFD document as fixed sheets (mm -> px at 96 dpi): template pages
 * under (or over) the page content, then text, path and image objects absolutely positioned.
 * Stops at `maxPages` or when the long-input budget is spent after a page.
 */
export function renderOfd(pkg: OfdPackage, options: OfdRenderOptions): OfdRender {
  const cx: Context = {
    ...options,
    pkg,
    stats: { composite: 0, missingImages: 0, objectsCut: 0, embeddedFonts: 0 },
    objects: 0,
  };
  const sheets: SheetSpec[] = [];
  const html: string[] = [];
  const pages = pkg.pages;
  for (let p = 0; p < pages.length; p++) {
    if (p >= options.maxPages || options.budget.exhausted) {
      options.budget.skip(pages.length - p);
      break;
    }
    const ref = pages[p] as (typeof pages)[number];
    let root: Element;
    try {
      root = part(cx, ref.path);
    } catch (error) {
      if (error instanceof DocumentError && p > 0) {
        options.budget.skip(1);
        continue;
      }
      throw error;
    }
    cx.objects = 0;
    const area = parseBox(kid(kid(root, null, "Area"), null, "PhysicalBox")?.textContent) ?? pkg.pageBox;
    let below = "";
    let above = "";
    for (const tpl of kids(root, null, "Template")) {
      const path = pkg.templates.get(tpl.getAttribute("TemplateID") ?? "");
      if (!path) continue;
      const content = contentHtml(part(cx, path), cx);
      if (tpl.getAttribute("ZOrder") === "Foreground") above += content;
      else below += content;
    }
    const body = contentHtml(root, cx);
    const spec: SheetSpec = { w: area.w * K, h: area.h * K, fixed: true };
    sheets.push(spec);
    const offset = area.x || area.y ? ` style="left:${px(-area.x * K)};top:${px(-area.y * K)}"` : "";
    html.push(
      `${openSheet(spec, { className: "ofd-page", label: `Page ${p + 1}` })}<div class="ofd-layer"${offset}>${below}${body}${above}</div></section>`,
    );
  }
  for (const font of pkg.fonts.values()) if (font.embedded) cx.stats.embeddedFonts++;
  const css = [
    ".ofd-page .ofd-layer{position:absolute;left:0;top:0;width:100%;height:100%;}",
    ".ofd-t,.ofd-p,.ofd-i,.ofd-o{position:absolute;overflow:visible;transform-origin:0 0;}",
    ".ofd-run{position:absolute;white-space:pre;}",
    ".ofd-g{display:inline-block;}",
    ".ofd-v{position:absolute;left:0;display:block;}",
    ".ofd-u{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0;}",
  ].join("");
  return { html: html.join(""), css, sheets, role: "page", stats: cx.stats };
}
