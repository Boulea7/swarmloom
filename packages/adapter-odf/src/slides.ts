import { blocks, type FlowContext, type FlowStats, frameBox, frameContent } from "./flow";
import type { ContentBudget } from "./kit/budget";
import { cssColor, lengthPx, percent, px, styleText } from "./kit/css";
import type { FontReport } from "./kit/fonts";
import { attrs, escapeHtml } from "./kit/html";
import { openSheet, type SheetRender, type SheetSpec } from "./kit/sheet";
import { a, child, children, isOdf, NS } from "./ns";
import { bodyOf, type OdfPackage } from "./package";
import { StyleClasses, textCss } from "./style-css";
import type { OdfStyles, Props } from "./styles";
import { cssMatrix, parseOdfTransform } from "./transform";

/** Result of rendering a presentation or drawing. */
export interface SlidesRender extends SheetRender {
  stats: FlowStats & { shapes: number; approximated: number };
  slides: number;
}

/** Default most slides rendered (S10). */
export const MAX_SLIDES = 20;

/** Placeholder classes whose master-page frames are prompts, not content. */
const PLACEHOLDERS = new Set([
  "title",
  "outline",
  "subtitle",
  "notes",
  "header",
  "footer",
  "date-time",
  "page-number",
  "text",
  "graphic",
  "object",
  "chart",
  "table",
  "orgchart",
  "page",
  "handout",
]);

interface ShapeContext extends FlowContext {
  shapeStats: { shapes: number; approximated: number };
  master: boolean;
}

interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: string;
  opacity?: number;
}

function graphicProps(el: Element, sc: ShapeContext): ReadonlyMap<string, string> | undefined {
  const props: Props[] = [];
  const graphic = sc.styles.resolve("graphic", a(el, "draw:style-name"), sc.scope)?.props;
  const presentation = sc.styles.resolve("presentation", a(el, "presentation:style-name"), sc.scope)?.props;
  if (presentation) props.push(presentation);
  if (graphic) props.push(graphic);
  if (props.length === 0) return sc.styles.defaultProps("graphic").graphic;
  const merged = new Map<string, string>(sc.styles.defaultProps("graphic").graphic ?? []);
  for (const p of props) for (const [k, v] of p.graphic ?? []) merged.set(k, v);
  return merged;
}

function gradientStart(name: string | undefined, sc: ShapeContext): string | undefined {
  if (!name) return undefined;
  const roots = [sc.pkg.styles, sc.pkg.content].filter((r): r is Element => !!r);
  for (const root of roots) {
    for (const g of children(child(root, "office", "styles") ?? root, "draw", "gradient")) {
      if (a(g, "draw:name") === name) return cssColor(a(g, "draw:start-color"));
    }
  }
  return undefined;
}

function paintOf(el: Element, sc: ShapeContext): Paint {
  const g = graphicProps(el, sc);
  const fillKind = g?.get("draw:fill") ?? "solid";
  let fill = "none";
  if (fillKind === "solid") fill = cssColor(g?.get("draw:fill-color")) ?? "#729FCF";
  else if (fillKind === "gradient") {
    fill = gradientStart(g?.get("draw:fill-gradient-name"), sc) ?? cssColor(g?.get("draw:fill-color")) ?? "#729FCF";
    sc.shapeStats.approximated++;
  } else if (fillKind !== "none") {
    fill = cssColor(g?.get("draw:fill-color")) ?? "#729FCF";
    sc.shapeStats.approximated++;
  }
  const strokeKind = g?.get("draw:stroke") ?? "solid";
  const stroke = strokeKind === "none" ? "none" : (cssColor(g?.get("svg:stroke-color")) ?? "#3465A4");
  const paint: Paint = { fill, stroke, strokeWidth: Math.max(lengthPx(g?.get("svg:stroke-width")) ?? 0, 1) };
  if (strokeKind === "dash") paint.dash = `${paint.strokeWidth * 4} ${paint.strokeWidth * 3}`;
  const opacity = percent(g?.get("draw:opacity"));
  if (opacity !== undefined) paint.opacity = Math.max(0, Math.min(1, opacity));
  return paint;
}

function paintAttrs(p: Paint): string {
  return attrs({
    fill: p.fill,
    stroke: p.stroke,
    "stroke-width": p.stroke === "none" ? undefined : Math.round(p.strokeWidth * 100) / 100,
    "stroke-dasharray": p.dash,
    opacity: p.opacity,
    "vector-effect": "non-scaling-stroke",
  });
}

/**
 * Places a shape box: plain left/top, or a CSS matrix from `draw:transform`, which then carries the
 * position too (svg:x/svg:y are not used alongside it).
 */
function placement(el: Element, w: number, h: number): string {
  const box = frameBox(el);
  const transform = parseOdfTransform(a(el, "draw:transform"));
  const base = { width: px(w), height: px(h) };
  if (transform) {
    return styleText({ left: "0px", top: "0px", ...base, transform: cssMatrix(transform), "transform-origin": "0 0" });
  }
  return styleText({ left: px(box.x ?? 0), top: px(box.y ?? 0), ...base });
}

function shapeText(el: Element, sc: ShapeContext, align: "top" | "middle" | "bottom"): string {
  const inner = blocks(el, sc).join("");
  if (!inner) return "";
  return `<div class="odp-text odp-${align}">${inner}</div>`;
}

function verticalAlign(el: Element, sc: ShapeContext, fallback: "top" | "middle"): "top" | "middle" | "bottom" {
  const v = graphicProps(el, sc)?.get("draw:textarea-vertical-align");
  return v === "middle" || v === "bottom" || v === "top" ? v : fallback;
}

const SIMPLE_PATH = /^[\sMLCQZNFS\d.eE+-]*$/;

/** Converts a formula-free `draw:enhanced-path` into SVG path data, or undefined. */
export function enhancedPath(path: string | null | undefined): string | undefined {
  if (!path || !SIMPLE_PATH.test(path)) return undefined;
  const d = path.replace(/[NFS]/g, " ").replace(/\s+/g, " ").trim();
  return /^M/.test(d) ? d : undefined;
}

function customGeometry(el: Element, w: number, h: number, sc: ShapeContext): string {
  const geo = child(el, "draw", "enhanced-geometry");
  const type = a(geo ?? el, "draw:type") ?? "rectangle";
  const p = paintAttrs(paintOf(el, sc));
  switch (type) {
    case "rectangle":
    case "rect":
    case "frame":
      return `<rect x="0" y="0" width="${w}" height="${h}"${p}/>`;
    case "round-rectangle": {
      const r = Math.min(w, h) / 6;
      return `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}"${p}/>`;
    }
    case "ellipse":
    case "circle":
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"${p}/>`;
    case "isosceles-triangle":
      return `<polygon points="${w / 2},0 ${w},${h} 0,${h}"${p}/>`;
    case "right-triangle":
      return `<polygon points="0,0 0,${h} ${w},${h}"${p}/>`;
    case "diamond":
      return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}"${p}/>`;
  }
  const d = enhancedPath(a(geo ?? el, "draw:enhanced-path"));
  const vb = (a(geo ?? el, "svg:viewBox") ?? "0 0 21600 21600")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (d && vb.length === 4 && vb.every(Number.isFinite) && (vb[2] as number) > 0 && (vb[3] as number) > 0) {
    const sx = w / (vb[2] as number);
    const sy = h / (vb[3] as number);
    return `<path d="${escapeHtml(d)}" transform="scale(${sx} ${sy}) translate(${-(vb[0] as number)} ${-(vb[1] as number)})"${p}/>`;
  }
  sc.shapeStats.approximated++;
  return `<rect x="0" y="0" width="${w}" height="${h}"${p}/>`;
}

function svgWrap(el: Element, w: number, h: number, body: string, text: string, viewBox = `0 0 ${w} ${h}`): string {
  return `<div class="odp-shape" style="${placement(el, w, h)}"><svg class="odp-svg" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>${text}</div>`;
}

function pointsAttr(value: string | null): string | undefined {
  if (!value || !/^[\d.\s,eE+-]+$/.test(value)) return undefined;
  return value.trim();
}

/** One drawing element of a slide (frames, basic and custom shapes, lines, polygons, groups). */
function shape(el: Element, sc: ShapeContext): string {
  if (el.namespaceURI !== NS.draw) return "";
  if (sc.master && isOdf(el, "draw", "frame") && PLACEHOLDERS.has(a(el, "presentation:class") ?? "")) return "";
  if (a(el, "presentation:placeholder") === "true") return "";
  if (el.localName === "g") return Array.from(el.children, (c) => shape(c, sc)).join("");
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!sc.budget.take(text.length)) return "";
  sc.shapeStats.shapes++;
  const box = frameBox(el);
  const w = box.w ?? 0;
  const h = box.h ?? 0;
  switch (el.localName) {
    case "frame": {
      const inner = frameContent(el, sc);
      if (!inner) return "";
      const v = verticalAlign(el, sc, "top");
      const klass = [
        "odp-frame",
        sc.classes.of("presentation", a(el, "presentation:style-name"), sc.scope),
        sc.classes.of("graphic", a(el, "draw:style-name"), sc.scope),
      ]
        .filter((c) => c)
        .join(" ");
      const isText = !!child(el, "draw", "text-box");
      return `<div${attrs({ class: klass, style: placement(el, w, h) })}>${isText ? `<div class="odp-text odp-${v}">${inner}</div>` : inner}</div>`;
    }
    case "rect":
    case "custom-shape": {
      const body =
        el.localName === "rect"
          ? `<rect x="0" y="0" width="${w}" height="${h}"${attrs({ rx: lengthPx(a(el, "draw:corner-radius")) })}${paintAttrs(paintOf(el, sc))}/>`
          : customGeometry(el, w, h, sc);
      return svgWrap(el, w, h, body, shapeText(el, sc, verticalAlign(el, sc, "middle")));
    }
    case "ellipse":
    case "circle":
      return svgWrap(
        el,
        w,
        h,
        `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"${paintAttrs(paintOf(el, sc))}/>`,
        shapeText(el, sc, "middle"),
      );
    case "line":
    case "connector": {
      const x1 = lengthPx(a(el, "svg:x1")) ?? 0;
      const y1 = lengthPx(a(el, "svg:y1")) ?? 0;
      const x2 = lengthPx(a(el, "svg:x2")) ?? 0;
      const y2 = lengthPx(a(el, "svg:y2")) ?? 0;
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const lw = Math.max(Math.abs(x2 - x1), 1);
      const lh = Math.max(Math.abs(y2 - y1), 1);
      const paint = { ...paintOf(el, sc), fill: "none" };
      const line = `<line x1="${x1 - left}" y1="${y1 - top}" x2="${x2 - left}" y2="${y2 - top}"${paintAttrs(paint)}/>`;
      return `<div class="odp-shape" style="${styleText({ left: px(left), top: px(top), width: px(lw), height: px(lh) })}"><svg class="odp-svg" width="${lw}" height="${lh}" viewBox="0 0 ${lw} ${lh}" overflow="visible" aria-hidden="true">${line}</svg></div>`;
    }
    case "polygon":
    case "polyline":
    case "path": {
      const vb = (a(el, "svg:viewBox") ?? `0 0 ${w} ${h}`).trim();
      if (!/^[\d.\s,eE+-]+$/.test(vb)) return "";
      const paint = paintOf(el, sc);
      if (el.localName === "polyline") paint.fill = "none";
      const body =
        el.localName === "path"
          ? (() => {
              const d = a(el, "svg:d");
              return d && /^[\sMmLlHhVvCcSsQqTtAaZz\d.,eE+-]+$/.test(d) ? `<path d="${d}"${paintAttrs(paint)}/>` : "";
            })()
          : (() => {
              const pts = pointsAttr(a(el, "draw:points"));
              return pts ? `<${el.localName} points="${pts}"${paintAttrs(paint)}/>` : "";
            })();
      return body ? svgWrap(el, w, h, body, shapeText(el, sc, "middle"), vb) : "";
    }
    default:
      return "";
  }
}

function background(props: Props | undefined): string | undefined {
  const p = props?.["drawing-page"];
  if (!p) return undefined;
  if (p.get("draw:fill") === "none") return undefined;
  return cssColor(p.get("draw:fill-color")) ?? undefined;
}

function baseCss(defaultText: string): string {
  return [
    `.odp{${defaultText}line-height:1.2;overflow:hidden;}`,
    ".odp p,.odp h1,.odp h2,.odp h3,.odp h4,.odp h5,.odp h6{margin:0;font-size:inherit;font-weight:inherit;}",
    ".odp ul,.odp ol{margin:0;}",
    ".odp .odp-frame,.odp .odp-shape{position:absolute;}",
    ".odp .odp-svg{position:absolute;left:0;top:0;overflow:visible;}",
    ".odp .odp-text{position:absolute;inset:0;display:flex;flex-direction:column;padding:4px 8px;}",
    ".odp .odp-top{justify-content:flex-start}.odp .odp-middle{justify-content:center}.odp .odp-bottom{justify-content:flex-end}",
    ".odp .odp-shape .odp-text{text-align:center;}",
    ".odp .odf-img{display:block;width:100%;height:100%;object-fit:fill;}",
    ".odp .odf-object{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#F1F1F5;color:#6B6B7B;font:12px sans-serif;}",
    ".odp .odf-table{border-collapse:collapse;width:100%;}",
    ".odp .odf-cell{padding:2px 6px;vertical-align:top;}",
    ".odp .odf-tab{white-space:pre;}",
    ".odp .odf-link{text-decoration:underline;}",
  ].join("");
}

/** Renders the pages of an ODP (or ODG) body as fixed-size slide sheets. */
export function renderSlides(
  pkg: OdfPackage,
  styles: OdfStyles,
  fonts: FontReport,
  budget: ContentBudget,
  maxSlides = MAX_SLIDES,
): SlidesRender {
  const classes = new StyleClasses(styles, fonts, "odp");
  const stats = { objects: 0, tableCuts: 0, shapes: 0, approximated: 0 };
  const shapeStats = { shapes: 0, approximated: 0 };
  const sc: ShapeContext = {
    pkg,
    styles,
    classes,
    budget,
    stats,
    scope: "content",
    notes: [],
    hoisted: [],
    page: 1,
    shapeStats,
    master: false,
  };
  const pages = children(bodyOf(pkg), "draw", "page");
  const sheets: SheetSpec[] = [];
  let html = "";
  let index = 0;
  for (; index < pages.length && index < maxSlides && !budget.exhausted; index++) {
    const page = pages[index] as Element;
    const master = styles.master(a(page, "draw:master-page-name"));
    const layout = master?.layout ?? styles.defaultLayout();
    const spec: SheetSpec = { w: layout.width, h: layout.height, fixed: true };
    sc.page = index + 1;
    const bg =
      background(styles.resolve("drawing-page", a(page, "draw:style-name"))?.props) ??
      background(styles.resolve("drawing-page", master?.drawStyle, "styles")?.props) ??
      layout.background ??
      "#FFFFFF";
    let content = "";
    if (master) {
      sc.scope = "styles";
      sc.master = true;
      content += Array.from(master.el.children)
        .map((c) => shape(c, sc))
        .join("");
      sc.scope = "content";
      sc.master = false;
    }
    content += Array.from(page.children)
      .map((c) => shape(c, sc))
      .join("");
    const name = a(page, "draw:name") ?? `Slide ${index + 1}`;
    html += `${openSheet(spec, { className: "odp", label: name, style: `background:${bg};` })}${content}</section>`;
    sheets.push(spec);
  }
  budget.skip(pages.length - index);
  stats.shapes = shapeStats.shapes;
  stats.approximated = shapeStats.approximated;
  const defaultText = styleText(textCss(styles.defaultProps("graphic").text, styles, fonts));
  return { html, css: baseCss(defaultText) + classes.css(), sheets, role: "slide", stats, slides: sheets.length };
}
