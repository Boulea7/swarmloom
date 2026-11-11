import type { CSSMap, Point, TextLayer } from "../../types";
import { applyLayerStyle } from "../sanitize";
import { clamp01, contentDiv, type LayerView, type MountEnv, Shell, Transient } from "./common";
import { TextIndex, type TextRun } from "./typing";

const BLOCK = 64;

/**
 * Transient properties that move, clip or fade the text as a whole: glyphs keep their place
 * inside it, so measured carets stay valid (snap and copy drags set them every frame).
 */
const PAINT_ONLY = new Set(["translate", "opacity", "clip-path"]);

/** True when replacing transient properties `prev` with `next` may move glyphs inside the text. */
function movesGlyphs(prev: Iterable<string>, next: CSSMap | null): boolean {
  for (const name of prev) if (!PAINT_ONLY.has(name)) return true;
  if (next) for (const name of Object.keys(next)) if (!PAINT_ONLY.has(name)) return true;
  return false;
}

/**
 * Caret positions measured with Range rects, a block of 64 boundaries per layout read and
 * cached until the geometry changes (transient styles, web fonts). Typing itself does not
 * move glyphs, so a typing agent costs one measurement per 64 characters, and that measurement
 * can be taken ahead of time ({@link CaretCache.prefetch}) in the stage's read phase, before a
 * frame's DOM writes, instead of mid-frame after other agents' writes (a forced layout each).
 */
class CaretCache {
  readonly #blocks = new Map<number, Float64Array>();
  #gen = -1;

  invalidate(): void {
    this.#blocks.clear();
  }

  /** True when the block of boundary `u` is measured for geometry `gen`: get() reads no layout. */
  has(u: number, gen: number): boolean {
    return gen === this.#gen && this.#blocks.has(Math.floor(u / BLOCK));
  }

  get(index: TextIndex, root: HTMLElement, u: number, gen: number, scale: number): Point | null {
    const b = Math.floor(u / BLOCK);
    const block = this.#block(index, root, b, gen, scale);
    const i = (u - b * BLOCK) * 2;
    const x = block[i] ?? Number.NaN;
    const y = block[i + 1] ?? Number.NaN;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  /** Measures the block of boundary `u` if needed, and the next block once `u` is past the middle of its own. */
  prefetch(index: TextIndex, root: HTMLElement, u: number, gen: number, scale: number): void {
    const b = Math.floor(u / BLOCK);
    this.#block(index, root, b, gen, scale);
    if (u - b * BLOCK >= BLOCK / 2 && (b + 1) * BLOCK <= index.total) this.#block(index, root, b + 1, gen, scale);
  }

  #block(index: TextIndex, root: HTMLElement, b: number, gen: number, scale: number): Float64Array {
    if (gen !== this.#gen) {
      this.#blocks.clear();
      this.#gen = gen;
    }
    let block = this.#blocks.get(b);
    if (!block) {
      block = measureBlock(index, root, b * BLOCK, scale);
      this.#blocks.set(b, block);
    }
    return block;
  }
}

function lastRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (r && (r.width > 0 || r.height > 0)) return r;
  }
  return null;
}

function unitRect(index: TextIndex, range: Range, r: TextRun, local: number): DOMRect | null {
  const [sn, so] = index.position(r, local, false);
  const [en, eo] = index.position(r, local + 1, true);
  try {
    if (sn === en) {
      range.setStart(sn, so);
      range.setEnd(en, eo);
      return lastRect(range);
    }
  } catch {
    // offsets out of range after external DOM edits
  }
  return null;
}

/** Layer-local caret positions (x, y of the glyph box top) for boundaries [from, from + BLOCK). */
function measureBlock(index: TextIndex, root: HTMLElement, from: number, scale: number): Float64Array {
  const out = new Float64Array(BLOCK * 2).fill(Number.NaN);
  const origin = root.getBoundingClientRect();
  const range = root.ownerDocument.createRange();
  const s = scale > 0 ? scale : 1;
  let px = Number.NaN;
  let py = Number.NaN;
  for (let k = 0; k < BLOCK; k++) {
    const u = from + k;
    if (u > index.total) break;
    let rect: DOMRect | null = null;
    let after = true;
    if (u > 0) {
      const r = index.runOf(u - 1);
      if (r) rect = unitRect(index, range, r, u - 1 - r.first);
    }
    if (!rect) {
      const r = index.runOf(u);
      if (r) {
        rect = unitRect(index, range, r, u - r.first);
        after = false;
      }
    }
    if (rect) {
      px = ((after ? rect.right : rect.left) - origin.left) / s;
      py = (rect.top - origin.top) / s;
    } else if (!Number.isFinite(px)) {
      // Nothing measurable yet (empty text, collapsed whitespace): content box origin.
      px = 0;
      py = 0;
    }
    out[k * 2] = px;
    out[k * 2 + 1] = py;
  }
  return out;
}

/**
 * Text block. Reveal kinds: "type" (default; characters appear in place without reflow), "fade",
 * "stamp" (quick scale-in), "none" (appears at once). A typed text measures its carets in the
 * stage's read phase ({@link LayerView.measure}): the block at the typed position, and the next
 * one near its end.
 */
export function mountText(env: MountEnv, layer: TextLayer, z: number): LayerView {
  const shell = new Shell(env, layer, z);
  const content = contentDiv(env.doc);
  applyLayerStyle(content, layer.style);
  content.append(env.html(layer.id, layer.html));
  env.inlineStyles(content);
  shell.shell.append(content);
  const mode = layer.reveal === "fade" || layer.reveal === "stamp" || layer.reveal === "none" ? layer.reveal : "type";
  const transient = new Transient();
  const carets = new CaretCache();
  let index: TextIndex | null = null;
  const getIndex = (): TextIndex => {
    index ??= new TextIndex(content, env.segmenter);
    return index;
  };
  /** Last reveal progress: where typing is, and so which caret block comes next. */
  let progress = 0;
  /** Typing boundary of `units`, clamped to the text. */
  const boundary = (units: number): number => Math.max(0, Math.min(getIndex().total, Math.round(units)));

  return {
    outer: shell.outer,
    el: content,
    reveal(p) {
      progress = clamp01(p);
      if (!(p > 0)) {
        shell.setVisible(false);
        if (mode === "type" && index?.wrapped) index.show(0);
        return;
      }
      shell.setVisible(true);
      if (p >= 1) {
        index?.unwrap();
        shell.alpha(1);
        shell.extraTransform("");
        return;
      }
      switch (mode) {
        case "type": {
          const ix = getIndex();
          shell.alpha(1);
          if (ix.total > 0) ix.show(p * ix.total);
          break;
        }
        case "fade":
          shell.alpha(p);
          break;
        case "stamp": {
          const t = clamp01(p * 2.5);
          shell.alpha(t);
          const k = 1 + 0.06 * (1 - t) * (1 - t);
          shell.extraTransform(env.reducedMotion ? "" : `scale(${k.toFixed(4)})`);
          break;
        }
        default:
          shell.alpha(1);
      }
    },
    finish() {
      if (movesGlyphs(transient.names(), null)) carets.invalidate();
      transient.clear(content);
      this.reveal(1);
    },
    transient(css) {
      const moves = movesGlyphs(transient.names(), css);
      transient.apply(content, css);
      if (moves) carets.invalidate();
    },
    total() {
      return getIndex().total;
    },
    caret(units) {
      const local = carets.get(getIndex(), content, boundary(units), env.geometryGen(), env.scale());
      if (!local) return null;
      return { x: layer.box.x + local.x, y: layer.box.y + local.y };
    },
    caretReady(units) {
      return carets.has(boundary(units), env.geometryGen());
    },
    measure() {
      if (mode !== "type" || !content.isConnected) return;
      const ix = getIndex();
      carets.prefetch(ix, content, Math.round(progress * ix.total), env.geometryGen(), env.scale());
    },
    destroy() {
      index = null;
    },
  };
}
