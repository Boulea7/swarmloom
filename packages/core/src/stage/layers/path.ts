import type { CSSMap, PathLayer } from "../../types";
import { applyLayerStyle, isSafeDeclaration } from "../sanitize";
import { type LayerView, type MountEnv, Shell, smooth, Transient } from "./common";

const SVG_NS = "http://www.w3.org/2000/svg";
const ATTR = /^[a-z][a-z0-9-]*$/;
/** Presentation attributes accepted from PathLayer.attrs. */
const ALLOWED = new Set([
  "fill-rule",
  "clip-rule",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "vector-effect",
  "paint-order",
  "shape-rendering",
  "transform",
  "mix-blend-mode",
  "filter",
  "clip-path",
  "mask",
  "marker-start",
  "marker-mid",
  "marker-end",
]);
const MARKERS = new Set(["marker-start", "marker-mid", "marker-end"]);
const FRAGMENT_URL = /url\(\s*(['"]?)#[\w.:-]+\1\s*\)/gi;

/**
 * True unless `v` references a resource other than an element of the world tree: paint servers,
 * clip paths, masks, markers and filters are emitted by adapters as `url(#id)` into a defs layer;
 * external references (network requests, other documents) are refused.
 */
function localRefsOnly(v: string): boolean {
  return !/url\(/i.test(v.replace(FRAGMENT_URL, ""));
}

/** Parses a `style` attribute value into declarations (values may contain parentheses, not ";"). */
function parseStyle(text: string): CSSMap {
  const out: CSSMap = {};
  if (text.length > 4096) return out;
  for (const part of text.split(";")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (value && localRefsOnly(value)) out[name] = value;
  }
  return out;
}

function svgEl<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag);
}

function validPaint(v: string | undefined): v is string {
  return (
    typeof v === "string" && v !== "none" && v !== "transparent" && isSafeDeclaration("fill", v) && localRefsOnly(v)
  );
}

/** `v` CSS px rounded to Blink's and WebKit's layout unit (1/64 px), at least one unit. */
function layoutUnits(v: number): number {
  const units = Number.isFinite(v) ? Math.round(v * 64) : 1;
  return Math.max(units, 1) / 64;
}

/**
 * Vector path in stage coordinates. Reveal "pen"/"trace" draws the stroke along its length
 * (stroke-dasharray/offset, or a mask when the stroke is dashed itself) and fades the fill in at
 * the end; fill-only shapes are traced with a thin outline first. "fade" is a plain fade.
 */
export function mountPath(env: MountEnv, layer: PathLayer, z: number): LayerView {
  const doc = env.doc;
  const shell = new Shell(env, layer, z);
  const b = layer.box;
  const svg = svgEl(doc, "svg");
  svg.setAttribute("class", "sl-c");
  // The svg and its viewBox get the same size in whole layout units, so the viewBox scale is
  // exactly 1. A box of 431.17 px lays out as 431.15625 px; the resulting 0.99997 scale came out one
  // float ulp apart from one Chromium paint to the next, which moved antialiased path ends by one
  // colour level between two renders of the same frame (seen at --scale 1.5).
  const vw = layoutUnits(b.w);
  const vh = layoutUnits(b.h);
  svg.setAttribute("viewBox", `${b.x} ${b.y} ${vw} ${vh}`);
  svg.style.width = `${vw}px`;
  svg.style.height = `${vh}px`;
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("overflow", "visible");
  svg.style.overflow = "visible";
  const d = typeof layer.d === "string" && layer.d.length < 2_000_000 ? layer.d : "";
  const attrs = layer.attrs && typeof layer.attrs === "object" ? layer.attrs : {};

  /** The fill element never takes dashes; markers go on the stroke element when there is one. */
  const applyAttrs = (el: SVGElement, skipDash: boolean, skipMarkers: boolean): void => {
    for (const name of Object.keys(attrs)) {
      const v = attrs[name];
      if (typeof v !== "string") continue;
      if (name === "style") {
        applyLayerStyle(el, parseStyle(v));
        continue;
      }
      if (!ATTR.test(name) || !ALLOWED.has(name) || !isSafeDeclaration(name, v) || !localRefsOnly(v)) continue;
      if (skipDash && (name === "stroke-dasharray" || name === "stroke-dashoffset")) continue;
      if (skipMarkers && MARKERS.has(name)) continue;
      el.setAttribute(name, v);
    }
  };

  const fillColor = validPaint(layer.fill) ? layer.fill : null;
  const strokeColor = validPaint(layer.stroke) ? layer.stroke : null;
  const sw = typeof layer.strokeWidth === "number" && Number.isFinite(layer.strokeWidth) ? layer.strokeWidth : 1;
  const dashed = typeof attrs["stroke-dasharray"] === "string" && attrs["stroke-dasharray"] !== "none";

  let fillPath: SVGPathElement | null = null;
  if (fillColor) {
    fillPath = svgEl(doc, "path");
    fillPath.setAttribute("d", d);
    applyAttrs(fillPath, true, strokeColor !== null);
    fillPath.setAttribute("fill", fillColor);
    fillPath.setAttribute("stroke", "none");
    svg.append(fillPath);
  }
  let strokePath: SVGPathElement | null = null;
  if (strokeColor) {
    strokePath = svgEl(doc, "path");
    strokePath.setAttribute("d", d);
    applyAttrs(strokePath, false, false);
    strokePath.setAttribute("fill", "none");
    strokePath.setAttribute("stroke", strokeColor);
    strokePath.setAttribute("stroke-width", String(sw));
    svg.append(strokePath);
  }
  shell.shell.append(svg);

  const mode = layer.reveal === "fade" ? "fade" : "draw";
  const transient = new Transient();
  let length = -1;
  let drawEl: SVGPathElement | null = null;
  let mask: SVGMaskElement | null = null;
  let ownMask: string | null = null;
  let trace: SVGPathElement | null = null;
  let lastOffset = Number.NaN;

  const measure = (): number => {
    if (length >= 0) return length;
    try {
      const probe = strokePath ?? fillPath;
      length = probe ? probe.getTotalLength() : 0;
    } catch {
      length = 0;
    }
    if (!Number.isFinite(length)) length = 0;
    return length;
  };

  /** Sets up the element whose dash offset animates the drawing. */
  const setupDraw = (): SVGPathElement | null => {
    if (drawEl) return drawEl;
    const L = measure();
    if (L <= 0) return null;
    if (strokePath && !dashed) {
      drawEl = strokePath;
    } else if (strokePath && dashed) {
      // Dashed stroke: reveal it through a mask whose own (solid) stroke is drawn progressively.
      const id = env.uid("m");
      mask = svgEl(doc, "mask");
      mask.setAttribute("id", id);
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      const pad = sw * 4 + 8;
      mask.setAttribute("x", String(b.x - pad));
      mask.setAttribute("y", String(b.y - pad));
      mask.setAttribute("width", String(b.w + pad * 2));
      mask.setAttribute("height", String(b.h + pad * 2));
      const mp = svgEl(doc, "path");
      mp.setAttribute("d", d);
      mp.setAttribute("fill", "none");
      mp.setAttribute("stroke", "#fff");
      mp.setAttribute("stroke-width", String(sw + 4));
      mp.setAttribute("stroke-linecap", "round");
      mask.append(mp);
      svg.prepend(mask);
      // A blueprint mask on the stroke is swapped out while drawing and restored when finished.
      ownMask = strokePath.getAttribute("mask");
      strokePath.setAttribute("mask", `url(#${id})`);
      drawEl = mp;
    } else {
      // Fill-only shape: trace a thin outline in the fill colour, removed when finished.
      trace = svgEl(doc, "path");
      trace.setAttribute("d", d);
      trace.setAttribute("fill", "none");
      trace.setAttribute("stroke", fillColor ?? env.tokens.select);
      trace.setAttribute("stroke-width", "1.25");
      trace.setAttribute("vector-effect", "non-scaling-stroke");
      trace.setAttribute("stroke-linejoin", "round");
      svg.append(trace);
      drawEl = trace;
    }
    drawEl.style.strokeDasharray = `${L} ${L}`;
    return drawEl;
  };

  const teardownDraw = (): void => {
    if (strokePath && drawEl === strokePath) {
      strokePath.style.removeProperty("stroke-dasharray");
      strokePath.style.removeProperty("stroke-dashoffset");
    }
    if (mask) {
      if (ownMask) strokePath?.setAttribute("mask", ownMask);
      else strokePath?.removeAttribute("mask");
      mask.remove();
      mask = null;
    }
    trace?.remove();
    trace = null;
    drawEl = null;
    lastOffset = Number.NaN;
  };

  const setFillAlpha = (a: number): void => {
    if (fillPath) fillPath.style.opacity = a >= 1 ? "" : String(Math.round(a * 1000) / 1000);
  };

  return {
    outer: shell.outer,
    el: svg,
    reveal(p) {
      if (!(p > 0)) {
        shell.setVisible(false);
        return;
      }
      shell.setVisible(true);
      if (p >= 1) {
        teardownDraw();
        setFillAlpha(1);
        shell.alpha(1);
        return;
      }
      if (mode === "fade") {
        shell.alpha(p);
        return;
      }
      shell.alpha(1);
      const el = setupDraw();
      if (!el) {
        shell.alpha(p);
        return;
      }
      const L = length;
      const off = Math.round(L * (1 - p) * 100) / 100;
      if (off !== lastOffset) {
        lastOffset = off;
        el.style.strokeDashoffset = String(off);
      }
      setFillAlpha(smooth(0.6, 1, p));
    },
    finish() {
      transient.clear(svg);
      this.reveal(1);
    },
    transient(css) {
      transient.apply(svg, css);
    },
    destroy() {
      drawEl = null;
    },
  };
}
