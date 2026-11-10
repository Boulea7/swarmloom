/**
 * Block heights for layout. In a browser the HTML is laid out in a hidden shadow-root sandbox with
 * the notebook style sheet, the way the stage will show it; without layout (DOM shims) heights are
 * estimated from the text so tests and headless tools still get a sensible blueprint.
 */

import { stringWidth } from "@swarmloom/adapter-terminal/ansi";
import type { CSSMap } from "@swarmloom/core";

export interface MeasureStyle {
  css: CSSMap;
  fontPx: number;
  linePx: number;
  /** Average advance per character, em (0.6 for monospace). */
  charEm: number;
  /** Vertical padding included in the height, px. */
  padY: number;
  /** Horizontal padding, px. */
  padX: number;
}

export interface Measurer {
  /** Height in px of `html` laid out `width` px wide with `style`. */
  height(html: string, width: number, style: MeasureStyle): number;
  dispose(): void;
}

/** Estimated height of `text` (newlines kept) wrapped to `width`. */
export function estimateHeight(text: string, width: number, style: MeasureStyle): number {
  const inner = Math.max(20, width - 2 * style.padX);
  const perLine = inner / (style.fontPx * style.charEm);
  let lines = 0;
  for (const line of text.split("\n")) lines += Math.max(1, Math.ceil(stringWidth(line) / perLine));
  return Math.ceil(lines * style.linePx + 2 * style.padY);
}

/** Creates a measurer that lays HTML out in `doc` with the style sheet `sheet`. */
export function createMeasurer(doc: Document, sheet: string): Measurer {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | HTMLElement | null = null;

  function sandbox(): ShadowRoot | HTMLElement | null {
    if (root) return root;
    if (!doc.body) return null;
    host = doc.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:absolute;left:-100000px;top:0;width:4000px;visibility:hidden;pointer-events:none;contain:layout style";
    root = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
    const style = doc.createElement("style");
    style.textContent = sheet;
    root.append(style);
    doc.body.append(host);
    return root;
  }

  return {
    height(html, width, style) {
      const box = sandbox();
      if (!box) return estimateHeight(textOf(doc, html), width, style);
      const el = doc.createElement("div");
      for (const [k, v] of Object.entries(style.css)) el.style.setProperty(k, v);
      el.style.setProperty("box-sizing", "border-box");
      el.style.setProperty("width", `${width}px`);
      el.innerHTML = html;
      box.append(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h > 0 ? Math.ceil(h) : estimateHeight(textOf(doc, html), width, style);
    },
    dispose() {
      host?.remove();
      host = null;
      root = null;
    },
  };
}

/** Text of `html` with a line break after every block, for estimates. */
function textOf(doc: Document, html: string): string {
  const tpl = doc.createElement("template");
  tpl.innerHTML = html.replace(/<\/(?:p|h[1-6]|li|tr|pre|blockquote|div|table|ul|ol)>|<br\s*\/?>|<hr\s*\/?>/gi, "$&\n");
  return (tpl.content.textContent ?? "").replace(/\n+$/, "");
}
