import type { Rect, Size } from "@swarmloom/core";
import { BLANK_PNG } from "../lottie/validate";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
/** Line breaks in Lottie text documents. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Lottie text documents use U+0003 (ETX) as a line break.
const LINE_BREAK = /\r\n|\r|\n|\u0003/;
/** Letter spacing below this is noise from rounding, px. */
const MIN_SPACING = 0.05;

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** Translation of a `matrix(1,0,0,1,e,f)` transform, or null for anything else. */
function translation(el: Element): { x: number; y: number } | null {
  const raw = el.getAttribute("transform");
  if (!raw) return { x: 0, y: 0 };
  const m = /^\s*matrix\(([^)]*)\)\s*$/.exec(raw);
  const v = m?.[1]?.split(/[\s,]+/).map(Number);
  if (v?.length !== 6 || v.some((n) => !Number.isFinite(n))) return null;
  const [a, b, c, d, e, f] = v as [number, number, number, number, number, number];
  const near = (p: number, q: number): boolean => Math.abs(p - q) < 1e-6;
  return near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1) ? { x: e, y: f } : null;
}

interface Letter {
  el: SVGTextElement;
  x: number;
  y: number;
}

/**
 * lottie-web draws text one `<text>` per letter inside a group labelled with the whole string.
 * When the letters are only translated (no per-letter animators), each line becomes one
 * `<text>` with the line's real characters (spaces included) at the first letter's position,
 * with letter spacing measured so the line spans what lottie-web laid out. The SVG adapter then
 * makes one typed text layer per line instead of one per letter. Anything else is left alone.
 *
 * Runs on the rendered (in-document) SVG: it measures text.
 */
export function mergeLetters(svg: SVGSVGElement): void {
  for (const group of Array.from(svg.querySelectorAll("g[aria-label]"))) {
    const label = group.getAttribute("aria-label") ?? "";
    const children = Array.from(group.children);
    if (children.length === 0 || children.some((c) => c.localName !== "text")) continue;
    const letters: Letter[] = [];
    let simple = true;
    for (const el of children as SVGTextElement[]) {
      const t = translation(el);
      const opacity = el.getAttribute("opacity");
      if (!t || (opacity !== null && Number(opacity) !== 1) || el.children.length > 0) {
        simple = false;
        break;
      }
      if ((el.textContent ?? "").trim() === "" || el.style.display === "none") continue;
      letters.push({ el, x: t.x, y: t.y });
    }
    if (!simple || letters.length < 2) continue;

    const rows = new Map<number, Letter[]>();
    for (const l of letters) {
      const key = Math.round(l.y * 2) / 2;
      const row = rows.get(key);
      if (row) row.push(l);
      else rows.set(key, [l]);
    }
    const lines = label
      .split(LINE_BREAK)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (lines.length !== rows.size) continue;
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, row] of ordered) row.sort((a, b) => a.x - b.x);
    // The label is the source text; letters may differ (all caps, small caps): then keep the letters.
    const squash = (s: string): string => s.replace(/\s+/g, "");
    const drawn = ordered.map(([, row]) => row.map((l) => l.el.textContent ?? "").join(""));
    if (drawn.some((d, i) => squash(d) !== squash(lines[i] as string))) continue;

    const doc = group.ownerDocument;
    const merged: SVGTextElement[] = [];
    ordered.forEach(([y, row], i) => {
      const first = row[0] as Letter;
      const last = row[row.length - 1] as Letter;
      const text = doc.createElementNS(SVG_NS, "text") as SVGTextElement;
      text.setAttribute("x", fmt(first.x));
      text.setAttribute("y", fmt(y));
      text.setAttributeNS(XML_NS, "xml:space", "preserve");
      const line = lines[i] as string;
      text.textContent = line;
      group.appendChild(text);
      const chars = [...line].length;
      const span = last.x + last.el.getComputedTextLength() - first.x;
      const natural = text.getComputedTextLength();
      const spacing = chars > 1 ? (span - natural) / (chars - 1) : 0;
      if (Math.abs(spacing) >= MIN_SPACING) text.setAttribute("letter-spacing", fmt(spacing));
      merged.push(text);
    });
    for (const l of letters) l.el.remove();
    for (const c of children) if (c.isConnected && !merged.includes(c as SVGTextElement)) c.remove();
  }
}

/** The single rect of a clipPath, when it covers exactly `size` from the origin. */
function isCanvasClip(clip: Element | null, size: Size): boolean {
  if (clip?.localName !== "clipPath" || clip.children.length !== 1) return false;
  const rect = clip.firstElementChild;
  if (rect?.localName !== "rect") return false;
  const n = (name: string): number => Number(rect.getAttribute(name) ?? "0");
  return n("x") === 0 && n("y") === 0 && n("width") === size.w && n("height") === size.h;
}

/** Where the composition sits in the stage world. */
export interface Placement {
  /** World size. */
  world: Size;
  /** Composition rectangle in the world. */
  rect: Rect;
}

/**
 * Serialises the frame shown in `svg` for the SVG adapter: drops lottie-web's text measuring
 * helpers, blank placeholder images and the canvas clip (the adapter clips layers to the
 * composition itself), and maps the composition onto its rectangle in the world.
 */
export function snapshotMarkup(svg: SVGSVGElement, comp: Size, place: Placement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const helper of Array.from(clone.querySelectorAll("defs > text"))) helper.remove();
  for (const image of Array.from(clone.querySelectorAll("image"))) {
    const href = image.getAttribute("href") ?? image.getAttributeNS(XLINK_NS, "href");
    if (href === BLANK_PNG) image.remove();
  }
  for (const group of Array.from(clone.querySelectorAll(":scope > g[clip-path]"))) {
    const id = /^url\(["']?#([^"')]+)["']?\)$/.exec(group.getAttribute("clip-path") ?? "")?.[1];
    const clip = id ? clone.querySelector(`clipPath[id="${CSS.escape(id)}"]`) : null;
    if (isCanvasClip(clip, comp)) {
      group.removeAttribute("clip-path");
      clip?.remove();
    }
  }
  const s = place.rect.w / comp.w;
  clone.removeAttribute("style");
  clone.setAttribute("width", fmt(place.world.w));
  clone.setAttribute("height", fmt(place.world.h));
  clone.setAttribute(
    "viewBox",
    [-place.rect.x / s, -place.rect.y / s, place.world.w / s, place.world.h / s].map(fmt).join(" "),
  );
  clone.setAttribute("preserveAspectRatio", "xMinYMin meet");
  return new XMLSerializer().serializeToString(clone);
}
