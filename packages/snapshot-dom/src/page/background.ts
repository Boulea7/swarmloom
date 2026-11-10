import { readBoxVisual, safeCssImages } from "../capture/styles";
import { viewOf } from "../dom/env";
import { parseColor } from "../util/color";
import { splitTopLevel } from "../util/css";

/** Canvas colours browsers use when nothing paints a background. */
const LIGHT_CANVAS = "rgb(255, 255, 255)";
const DARK_CANVAS = "rgb(18, 18, 18)";

export interface PageBackground {
  /** CSS `background` value for Blueprint.background. */
  css: string;
  scheme: "light" | "dark";
  /** Elements whose own box is the background and must not be drawn again. */
  sources: Element[];
}

/** `background` shorthand from computed longhands (multiple layers supported). */
export function backgroundCss(cs: CSSStyleDeclaration, base: string): string {
  const color = cs.backgroundColor;
  const image = cs.backgroundImage;
  if (!image || image === "none") return color;
  const images = splitTopLevel(safeCssImages(image, base));
  const positions = splitTopLevel(cs.backgroundPosition || "0% 0%");
  const sizes = splitTopLevel(cs.backgroundSize || "auto");
  const repeats = splitTopLevel(cs.backgroundRepeat || "repeat");
  const pick = (list: string[], i: number, fallback: string) => list[i % Math.max(1, list.length)] ?? fallback;
  const layers = images.map(
    (img, i) => `${img} ${pick(positions, i, "0% 0%")} / ${pick(sizes, i, "auto")} ${pick(repeats, i, "repeat")}`,
  );
  const last = layers.length - 1;
  if (parseColor(color).alpha > 0) layers[last] = `${layers[last]} ${color}`;
  return layers.join(", ");
}

function hasBackground(cs: CSSStyleDeclaration): boolean {
  const v = readBoxVisual(cs);
  return v.fill || v.image;
}

/** A plain filled box without decoration, i.e. one that can stand in for the canvas. */
function isPlainFill(cs: CSSStyleDeclaration): boolean {
  const v = readBoxVisual(cs);
  if (!(v.fill || v.image) || v.shadow || v.anySide || v.outline || v.backdrop) return false;
  if (parseColor(cs.backgroundColor).alpha < 0.99 && !v.image) return false;
  return cs.borderRadius === "0px" || cs.borderRadius === "";
}

function schemeOf(bg: string, textColor: string, rootScheme: string): "light" | "dark" {
  const l = parseColor(bg).luminance;
  if (l !== null && parseColor(bg).alpha > 0.5) return l < 0.25 ? "dark" : "light";
  const t = parseColor(textColor).luminance;
  if (t !== null) return t > 0.5 ? "dark" : "light";
  return rootScheme.includes("dark") && !rootScheme.includes("light") ? "dark" : "light";
}

function canvasDefault(doc: Document): string {
  const view = viewOf(doc);
  const scheme = view.getComputedStyle(doc.documentElement).getPropertyValue("color-scheme");
  const dark = scheme.includes("dark");
  const light = scheme.includes("light");
  if (dark && !light) return DARK_CANVAS;
  if (dark && light && view.matchMedia?.("(prefers-color-scheme: dark)").matches) return DARK_CANVAS;
  return LIGHT_CANVAS;
}

/**
 * Finds a full-bleed wrapper that paints the page background in app layouts where html and body
 * are transparent (e.g. `<div id="app" style="min-height:100vh;background:...">`).
 */
function fullBleed(doc: Document, worldHeight: number): Element | null {
  const view = viewOf(doc);
  const vw = doc.documentElement.clientWidth || view.innerWidth;
  let cur: Element | null = doc.body;
  for (let depth = 0; cur && depth < 4; depth++) {
    let next: Element | null = null;
    for (const child of Array.from(cur.children)) {
      const cs = view.getComputedStyle(child);
      if (cs.display === "none" || cs.position === "fixed" || cs.position === "absolute") continue;
      const r = child.getBoundingClientRect();
      if (r.width < vw * 0.98 || r.left > 1 || r.top + view.scrollY > 1) break;
      if (r.height >= Math.min(worldHeight, view.innerHeight) * 0.9) {
        if (isPlainFill(cs)) return child;
        if (hasBackground(cs)) return null;
        next = child;
      }
      break;
    }
    cur = next;
  }
  return null;
}

/** Background of a live document: html, else body (canvas propagation), else a full-bleed wrapper. */
export function documentBackground(doc: Document, worldHeight: number): PageBackground {
  const view = viewOf(doc);
  const html = doc.documentElement;
  const body = doc.body;
  const htmlCs = view.getComputedStyle(html);
  const rootScheme = htmlCs.getPropertyValue("color-scheme");
  const textColor = body ? view.getComputedStyle(body).color : htmlCs.color;
  const base = doc.baseURI;
  if (hasBackground(htmlCs)) {
    const css = backgroundCss(htmlCs, base);
    return { css, scheme: schemeOf(htmlCs.backgroundColor, textColor, rootScheme), sources: [html] };
  }
  if (body) {
    const bodyCs = view.getComputedStyle(body);
    if (hasBackground(bodyCs)) {
      return {
        css: backgroundCss(bodyCs, base),
        scheme: schemeOf(bodyCs.backgroundColor, textColor, rootScheme),
        sources: [html, body],
      };
    }
    const wrapper = fullBleed(doc, worldHeight);
    if (wrapper) {
      const cs = view.getComputedStyle(wrapper);
      return {
        css: backgroundCss(cs, base),
        scheme: schemeOf(cs.backgroundColor, cs.color, rootScheme),
        sources: [html, body, wrapper],
      };
    }
  }
  const canvas = canvasDefault(doc);
  return { css: canvas, scheme: schemeOf(canvas, textColor, rootScheme), sources: [html] };
}

/**
 * Background of an element snapshot: the element's own plain fill (then not drawn as a box), else
 * the nearest ancestor background, else the document canvas.
 */
export function elementBackground(root: Element): PageBackground {
  const doc = root.ownerDocument;
  const view = viewOf(root);
  const cs = view.getComputedStyle(root);
  const rootScheme = view.getComputedStyle(doc.documentElement).getPropertyValue("color-scheme");
  if (isPlainFill(cs))
    return {
      css: backgroundCss(cs, root.baseURI),
      scheme: schemeOf(cs.backgroundColor, cs.color, rootScheme),
      sources: [root],
    };
  let cur: Element | null = root.parentElement;
  while (cur) {
    const pcs = view.getComputedStyle(cur);
    if (parseColor(pcs.backgroundColor).alpha > 0.5) {
      return { css: pcs.backgroundColor, scheme: schemeOf(pcs.backgroundColor, cs.color, rootScheme), sources: [] };
    }
    cur = cur.parentElement;
  }
  const canvas = canvasDefault(doc);
  return { css: canvas, scheme: schemeOf(canvas, cs.color, rootScheme), sources: [] };
}
