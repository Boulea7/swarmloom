import type { GraphemeSegmenter } from "./common";

/**
 * Typing without reflow. Each text node of a text layer becomes
 *   <sl-t>typed<sl-h style="visibility:hidden">untyped</sl-h></sl-t>
 * so untyped characters keep occupying their final place: line breaks, justification and inline
 * decorations (links, code spans, inline styles) are those of the finished text from the first
 * keystroke. Inline elements that have not been reached yet (code backgrounds, list markers,
 * images) are hidden with visibility as well. unwrap() restores the original nodes.
 *
 * Units are grapheme clusters; a run of HTML whitespace counts as one unit, as do <br> and replaced
 * elements (images, SVG icons, form controls), which appear in one keystroke.
 */

/** One text node and its unit boundaries. */
export interface TextRun {
  /** Original node; in the DOM whenever the run is not wrapped. */
  readonly node: Text;
  readonly text: string;
  /** Global index of the run's first unit. */
  readonly first: number;
  readonly count: number;
  /** UTF-16 offset of every unit boundary (count + 1 entries). */
  readonly offs: Uint32Array;
  /** Whitespace-only node: counted, never wrapped (it is invisible and must not change structure). */
  readonly phantom: boolean;
  wrap: HTMLElement | null;
  vis: Text | null;
  hid: Text | null;
  /** Units currently typed in this run (when wrapped). */
  shown: number;
}

interface Mark {
  readonly el: HTMLElement | SVGElement;
  /** Units before the element. */
  readonly first: number;
  /** Units up to the end of the element's subtree (== first for empty elements). */
  end: number;
  hidden: boolean;
  prev: string;
  prevPri: string;
}

/** Replaced or non-HTML content: appears in one keystroke and counts as one unit. */
const ATOMIC = new Set([
  "img",
  "svg",
  "math",
  "picture",
  "video",
  "audio",
  "canvas",
  "input",
  "textarea",
  "select",
  "iframe",
  "object",
  "meter",
  "progress",
]);
const MAX_DEPTH = 256;

const WS = /^[ \t\n\r\f]+$/;

function boundaries(text: string, seg: GraphemeSegmenter | null): Uint32Array {
  const out: number[] = [];
  let prevWs = false;
  if (seg) {
    for (const s of seg.segment(text)) {
      const ws = WS.test(s.segment);
      if (!(ws && prevWs)) out.push(s.index);
      prevWs = ws;
    }
  } else {
    for (let i = 0; i < text.length; ) {
      const cp = text.codePointAt(i) ?? 0;
      const len = cp > 0xffff ? 2 : 1;
      const ws = WS.test(text.slice(i, i + len));
      if (!(ws && prevWs)) out.push(i);
      prevWs = ws;
      i += len;
    }
  }
  out.push(text.length);
  return Uint32Array.from(out);
}

/**
 * Typing units of a plain string with the same rule as the DOM index: grapheme clusters, every run
 * of HTML whitespace counted once. Choreographies count TextLayer.text this way; when the markup
 * yields a different count (structural whitespace, <br>), the stage maps between the two.
 */
export function countTypingUnits(text: string, seg: GraphemeSegmenter | null): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return boundaries(text, seg).length - 1;
}

export class TextIndex {
  readonly runs: TextRun[] = [];
  readonly total: number;
  readonly #marks: Mark[] = [];
  readonly #doc: Document;
  readonly #seg: GraphemeSegmenter | null;
  #wrapped = false;
  #n = 0;

  constructor(root: HTMLElement, seg: GraphemeSegmenter | null) {
    this.#doc = root.ownerDocument;
    this.#seg = seg;
    this.total = this.#walk(root, 0, 0);
    this.#n = this.total;
  }

  /** Pre-order walk collecting text runs and element marks; returns the unit count after `node`. */
  #walk(node: Node, units0: number, depth: number): number {
    let units = units0;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = c as Text;
        const text = t.data;
        if (text.length === 0) continue;
        const phantom = WS.test(text);
        const offs = phantom ? Uint32Array.of(0, text.length) : boundaries(text, this.#seg);
        const count = offs.length - 1;
        this.runs.push({
          node: t,
          text,
          first: units,
          count,
          offs,
          phantom,
          wrap: null,
          vis: null,
          hid: null,
          shown: 0,
        });
        units += count;
      } else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as HTMLElement;
        const tag = el.localName;
        if (tag === "br") {
          units += 1;
          continue;
        }
        if (tag === "wbr") continue;
        const mark: Mark = { el, first: units, end: units, hidden: false, prev: "", prevPri: "" };
        this.#marks.push(mark);
        if (ATOMIC.has(tag)) units += 1;
        else if (depth < MAX_DEPTH) units = this.#walk(el, units, depth + 1);
        mark.end = units;
      }
    }
    return units;
  }

  /** Typed units (total when unwrapped). */
  get typed(): number {
    return this.#n;
  }

  get wrapped(): boolean {
    return this.#wrapped;
  }

  /** Shows the first `n` units; wraps text nodes on first use. */
  show(n: number): void {
    const target = Math.max(0, Math.min(this.total, Math.round(n)));
    if (!this.#wrapped) {
      if (target >= this.total) return;
      this.#wrap();
    }
    if (target === this.#n) return;
    const lo = Math.min(target, this.#n);
    const hi = Math.max(target, this.#n);
    this.#n = target;
    const runs = this.runs;
    for (let i = this.#runAt(lo); i < runs.length; i++) {
      const r = runs[i];
      if (!r || r.first > hi) break;
      if (r.phantom || !r.vis || !r.hid) continue;
      const local = Math.max(0, Math.min(r.count, target - r.first));
      if (local === r.shown) continue;
      const off = r.offs[local] ?? r.text.length;
      r.vis.data = r.text.slice(0, off);
      r.hid.data = r.text.slice(off);
      r.shown = local;
    }
    const marks = this.#marks;
    for (let i = this.#markAt(lo); i < marks.length; i++) {
      const m = marks[i];
      if (!m || m.first > hi) break;
      this.#mark(m, target > m.first || (m.end === m.first && target >= m.first));
    }
  }

  /** Restores the original text nodes and element styles (final state). */
  unwrap(): void {
    if (!this.#wrapped) return;
    this.#wrapped = false;
    this.#n = this.total;
    for (const r of this.runs) {
      if (r.wrap) r.wrap.replaceWith(r.node);
      r.wrap = null;
      r.vis = null;
      r.hid = null;
      r.shown = r.count;
    }
    for (const m of this.#marks) this.#mark(m, true);
  }

  /**
   * DOM position of unit boundary `local` inside run `r`, as [node, offset], for the current
   * wrap state. `end` picks the side when the boundary coincides with the typed/untyped split.
   */
  position(r: TextRun, local: number, end: boolean): [Text, number] {
    const off = r.offs[local] ?? r.text.length;
    if (!r.wrap || !r.vis || !r.hid) return [r.node, off];
    const split = r.offs[r.shown] ?? r.text.length;
    if (off < split || (off === split && end)) return [r.vis, off];
    return [r.hid, off - split];
  }

  /** Index of the run containing unit `u` (first run with first + count > u). */
  #runAt(u: number): number {
    const runs = this.runs;
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = runs[mid];
      if (r && r.first + r.count <= u) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  /** Run containing unit `u`, or undefined past the end. */
  runOf(u: number): TextRun | undefined {
    const runs = this.runs;
    for (let i = this.#runAt(u); i < runs.length; i++) {
      const r = runs[i];
      if (r && u >= r.first && u < r.first + r.count) return r;
      if (r && r.first > u) break;
    }
    return undefined;
  }

  #markAt(u: number): number {
    const marks = this.#marks;
    let lo = 0;
    let hi = marks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = marks[mid];
      if (m && m.first < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  #wrap(): void {
    const doc = this.#doc;
    for (const r of this.runs) {
      if (r.phantom || r.wrap) continue;
      const wrap = doc.createElement("sl-t");
      const vis = doc.createTextNode(r.text);
      const hidEl = doc.createElement("sl-h");
      hidEl.style.visibility = "hidden";
      const hid = doc.createTextNode("");
      hidEl.append(hid);
      wrap.append(vis, hidEl);
      r.node.replaceWith(wrap);
      r.wrap = wrap;
      r.vis = vis;
      r.hid = hid;
      r.shown = r.count;
    }
    this.#wrapped = true;
    this.#n = this.total;
  }

  #mark(m: Mark, visible: boolean): void {
    const hide = !visible;
    if (hide === m.hidden) return;
    const style = m.el.style;
    if (hide) {
      m.prev = style.getPropertyValue("visibility");
      m.prevPri = style.getPropertyPriority("visibility");
      style.setProperty("visibility", "hidden", "important");
    } else if (m.prev) {
      style.setProperty("visibility", m.prev, m.prevPri);
    } else {
      style.removeProperty("visibility");
    }
    m.hidden = hide;
  }
}
