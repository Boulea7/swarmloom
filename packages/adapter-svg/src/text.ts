import type { CSSMap, ImageLayer, Rect, TextLayer } from "@swarmloom/core";
import { BoundsBuilder, decompose, formatNumber, type Matrix, placeRect, transformRect } from "./path/geometry";
import { snapshotElement } from "./snapshot";
import { computedStyle, escapeHtml, num, parsePaint, withAlpha } from "./style";

/** Text layers are emitted without id/z/priority; the converter assigns those. */
export type TextDraft = Omit<TextLayer, "id"> | Omit<ImageLayer, "id">;

export interface TextEnv {
  /** User space of the text element (own transform included) -> stage. */
  m: Matrix;
  /** Opacity of the ancestors (the element's own opacity is not included). */
  groupOpacity: number;
  byId: ReadonlyMap<string, Element>;
}

/** Geometry of one addressable character in the text element's user space. */
export interface CharBox {
  /** Start position (baseline). */
  x: number;
  y: number;
  /** Glyph cell (advance x font ascent+descent). */
  box: Rect;
}

const TEXT_CONTAINERS = new Set(["text", "tspan", "textPath", "a"]);
const HEADING_PX = 28;

/**
 * Splits characters into visual lines: a new line starts where the baseline moves, or where the
 * next glyph does not touch the previous one (absolutely positioned chunks). Works for both
 * writing directions because only horizontal gaps are compared.
 */
export function splitLines(chars: readonly CharBox[], fontSize: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (chars.length === 0) return out;
  let from = 0;
  for (let i = 1; i < chars.length; i++) {
    const a = chars[i - 1] as CharBox;
    const b = chars[i] as CharBox;
    const gap = Math.max(b.box.x - (a.box.x + a.box.w), a.box.x - (b.box.x + b.box.w));
    if (Math.abs(b.y - a.y) > fontSize * 0.3 || gap > fontSize) {
      out.push([from, i]);
      from = i;
    }
  }
  out.push([from, chars.length]);
  return out;
}

/**
 * Collapses white space like the browser does for SVG text and records which element owns each
 * resulting character. `legacy` uses the SVG 1.1 rule (newlines removed instead of becoming spaces).
 */
export function collapseText(
  nodes: ReadonlyArray<{ text: string; owner: Element; preserve: boolean }>,
  legacy: boolean,
): { text: string; owners: Element[] } {
  let text = "";
  const owners: Element[] = [];
  for (const { text: raw, owner, preserve } of nodes) {
    for (const ch of raw) {
      let c = ch;
      if (c === "\n" || c === "\r") {
        if (legacy && !preserve) continue;
        c = " ";
      } else if (c === "\t") c = " ";
      if (!preserve && c === " " && (text.length === 0 || text.endsWith(" "))) continue;
      text += c;
      for (let k = 0; k < c.length; k++) owners.push(owner);
    }
  }
  while (text.endsWith(" ") && !nodes[nodes.length - 1]?.preserve) {
    text = text.slice(0, -1);
    owners.pop();
  }
  return { text, owners };
}

function textNodes(text: Element): Array<{ text: string; owner: Element; preserve: boolean }> {
  const out: Array<{ text: string; owner: Element; preserve: boolean }> = [];
  const walker = text.ownerDocument.createTreeWalker(text, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (!owner || !TEXT_CONTAINERS.has(owner.localName)) continue;
    const cs = computedStyle(owner);
    if (cs.display === "none") continue;
    const ws = cs.whiteSpace;
    const preserve = ws === "pre" || ws === "pre-wrap" || ws === "break-spaces" || ws === "pre-line";
    out.push({ text: node.nodeValue ?? "", owner, preserve });
  }
  return out;
}

interface RunStyle {
  key: string;
  css: CSSMap;
}

/** Inline CSS for a text run; font size and spacing are scaled to stage px. */
function runStyle(owner: Element, k: number): RunStyle {
  const cs = computedStyle(owner);
  const fill = parsePaint(cs.getPropertyValue("fill"));
  const colour = withAlpha(
    fill.colour === "none" ? "transparent" : fill.colour,
    num(cs.getPropertyValue("fill-opacity"), 1),
  );
  const css: CSSMap = {
    "font-family": cs.fontFamily,
    "font-size": `${formatNumber(num(cs.fontSize, 16) * k, 2)}px`,
    "font-weight": cs.fontWeight,
    "font-style": cs.fontStyle,
    color: colour,
  };
  const ls = cs.letterSpacing;
  if (ls && ls !== "normal" && num(ls) !== 0) css["letter-spacing"] = `${formatNumber(num(ls) * k, 2)}px`;
  const ws = cs.wordSpacing;
  if (ws && num(ws) !== 0) css["word-spacing"] = `${formatNumber(num(ws) * k, 2)}px`;
  const deco = cs.getPropertyValue("text-decoration-line");
  if (deco && deco !== "none") css["text-decoration-line"] = deco;
  const stroke = parsePaint(cs.getPropertyValue("stroke"));
  const sw = num(cs.getPropertyValue("stroke-width"), 1) * k;
  if (stroke.colour !== "none" && sw > 0) {
    css["-webkit-text-stroke"] =
      `${formatNumber(sw, 2)}px ${withAlpha(stroke.colour, num(cs.getPropertyValue("stroke-opacity"), 1))}`;
    css["paint-order"] = "stroke fill";
  }
  return { key: JSON.stringify(css), css };
}

function cssText(css: CSSMap): string {
  return Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/** Needs a vector snapshot instead of HTML text: text on a path, non-solid fills, effects. */
function needsSnapshot(text: Element): boolean {
  if (text.getElementsByTagName("textPath").length > 0) return true;
  const cs = computedStyle(text);
  if (cs.getPropertyValue("clip-path") !== "none" || cs.getPropertyValue("filter") !== "none") return true;
  if ((cs.getPropertyValue("mask-image") || "none") !== "none") return true;
  if (cs.getPropertyValue("writing-mode").startsWith("vertical")) return true;
  for (const el of [text, ...Array.from(text.getElementsByTagName("*"))]) {
    const paint = computedStyle(el).getPropertyValue("fill");
    if (paint.startsWith("url(")) return true;
  }
  return false;
}

function snapshotDraft(text: SVGTextElement, env: TextEnv): TextDraft | null {
  const bbox = text.getBBox();
  if (!(bbox.width > 0 && bbox.height > 0)) return null;
  const pad = 2;
  const r = transformRect(env.m, { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height });
  const box = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
  const fontSize = num(computedStyle(text).fontSize, 16) * Math.abs(decompose(env.m).sy);
  return {
    kind: "image",
    box,
    src: snapshotElement(text, env.m, box, env.byId),
    fit: "fill",
    reveal: "type",
    opacity: env.groupOpacity,
    role: fontSize >= HEADING_PX ? "heading" : undefined,
    meta: { tag: "text", snapshot: true, text: (text.textContent ?? "").replace(/\s+/g, " ").trim() },
  };
}

function alignFor(anchor: string, direction: string): string {
  if (anchor === "middle") return "center";
  const rtl = direction === "rtl";
  if (anchor === "end") return rtl ? "left" : "right";
  return rtl ? "right" : "left";
}

function lineDraft(
  text: string,
  owners: readonly Element[],
  rect: Rect,
  root: Element,
  env: TextEnv,
  k: number,
  styles: Map<Element, RunStyle>,
): TextDraft {
  const styleOf = (el: Element): RunStyle => {
    let s = styles.get(el);
    if (!s) {
      s = runStyle(el, k);
      styles.set(el, s);
    }
    return s;
  };
  const base = styleOf(owners[0] ?? root);
  let html = "";
  let runStart = 0;
  for (let i = 1; i <= text.length; i++) {
    const cur = i < text.length ? styleOf(owners[i] ?? root) : null;
    const prev = styleOf(owners[i - 1] ?? root);
    if (cur && cur.key === prev.key) continue;
    const chunk = escapeHtml(text.slice(runStart, i));
    if (prev.key === base.key) html += chunk;
    else {
      const diff: CSSMap = {};
      for (const [prop, v] of Object.entries(prev.css)) if (base.css[prop] !== v) diff[prop] = v;
      html += `<span style="${escapeHtml(cssText(diff))}">${chunk}</span>`;
    }
    runStart = i;
  }
  const rootStyle = computedStyle(root);
  const { box, transform } = placeRect(rect, env.m);
  const fontSize = num(base.css["font-size"], 16);
  const style: CSSMap = {
    ...base.css,
    "line-height": `${formatNumber(box.h, 2)}px`,
    "white-space": "pre",
    "text-align": alignFor(rootStyle.getPropertyValue("text-anchor"), rootStyle.direction),
  };
  return {
    kind: "text",
    box,
    transform,
    html,
    text,
    style,
    fontSize,
    reveal: "type",
    opacity: env.groupOpacity * num(rootStyle.opacity, 1),
    role: fontSize >= HEADING_PX ? "heading" : undefined,
    meta: { tag: "text" },
  };
}

/**
 * Converts an SVG `<text>` element into one text layer per visual line, typed in the stage as
 * HTML with the original fonts, colours and per-run styles. Text that HTML cannot reproduce
 * (text on a path, gradient fills, clipped/filtered/vertical text) becomes a vector snapshot image
 * revealed with the typing sweep instead.
 */
export function convertText(text: SVGTextElement, env: TextEnv): TextDraft[] {
  if (needsSnapshot(text)) {
    const draft = snapshotDraft(text, env);
    return draft ? [draft] : [];
  }
  const k = Math.abs(decompose(env.m).sy);
  const styles = new Map<Element, RunStyle>();
  const nodes = textNodes(text);
  const count = text.getNumberOfChars();
  let collapsed = collapseText(nodes, false);
  if (collapsed.text.length !== count) collapsed = collapseText(nodes, true);

  const out: TextDraft[] = [];
  if (collapsed.text.length === count && count > 0) {
    const fontSize = num(computedStyle(text).fontSize, 16);
    const chars: CharBox[] = [];
    try {
      for (let i = 0; i < count; i++) {
        const start = text.getStartPositionOfChar(i);
        const ext = text.getExtentOfChar(i);
        chars.push({ x: start.x, y: start.y, box: { x: ext.x, y: ext.y, w: ext.width, h: ext.height } });
      }
    } catch {
      chars.length = 0;
    }
    if (chars.length === count) {
      for (const [from, to] of splitLines(chars, fontSize)) {
        const line = collapsed.text.slice(from, to);
        if (line.trim() === "") continue;
        const b = new BoundsBuilder();
        for (let i = from; i < to; i++) {
          const r = (chars[i] as CharBox).box;
          b.add(r.x, r.y);
          b.add(r.x + r.w, r.y + r.h);
        }
        const rect = b.rect();
        if (!rect || rect.w <= 0 || rect.h <= 0) continue;
        out.push(lineDraft(line, collapsed.owners.slice(from, to), rect, text, env, k, styles));
      }
      return out;
    }
  }

  // Fallback: the browser and our white-space model disagree; one block for the whole element.
  const plain = (text.textContent ?? "").replace(/\s+/g, " ").trim();
  const bbox = text.getBBox();
  if (plain === "" || !(bbox.width > 0 && bbox.height > 0)) return out;
  const owners = new Array<Element>(plain.length).fill(text);
  out.push(lineDraft(plain, owners, { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height }, text, env, k, styles));
  return out;
}
