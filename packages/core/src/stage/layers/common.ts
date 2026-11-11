import type { Tokens } from "../../overlay/tokens";
import type { CSSMap, Layer, LayerRenderer, Point, StageApi } from "../../types";
import { isSafeDeclaration, safeTransform, setDecl } from "../sanitize";

/** Grapheme segmentation (Intl.Segmenter) when available. */
export interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string; index: number }>;
}

/** What layer views need from the stage. */
export interface MountEnv {
  readonly doc: Document;
  readonly tokens: Tokens;
  /** Stage-wide seed (from StageOptions.rng) mixed into per-layer visual jitter. */
  readonly seed: number;
  readonly reducedMotion: boolean;
  readonly api: StageApi;
  readonly segmenter: GraphemeSegmenter | null;
  /** Renderer for a custom layer task, if a plugin provides one. */
  renderer(task: string): LayerRenderer | undefined;
  /** CSS px per stage px (inline fit-to-width). */
  scale(): number;
  /** Bumped when layout-affecting global state changes (web fonts loaded). */
  geometryGen(): number;
  /** A fresh copy of the sanitized markup of a text layer (parsed, then cloned from a bounded cache). */
  html(id: string, raw: string): DocumentFragment;
  /**
   * Called with freshly inserted markup: when the page CSP dropped its style attributes, they are
   * re-applied through CSSOM (detected once, from the first styled element).
   */
  inlineStyles(root: Element): void;
  /** Unique id inside the world tree (SVG masks). */
  uid(prefix: string): string;
}

/** A mounted layer. */
export interface LayerView {
  /** Element attached to the world (clip wrapper or shell). */
  readonly outer: HTMLElement;
  /** Element exposed through StageApi.el(). */
  readonly el: HTMLElement | SVGElement | null;
  /** Never virtualized away (renders outside the DOM, or re-mounting would reset external state). */
  readonly pinned?: boolean;
  reveal(p: number): void;
  /** Final state: full reveal, transient styles cleared, no build-time decorations. */
  finish(): void;
  /** Transient inline styles on the content element; null clears. */
  transient(css: CSSMap | null): void;
  /** Caret position after `units` of `total()` typing units, stage coordinates (text layers). */
  caret?(units: number): Point | null;
  /** Typing units of a text layer. */
  total?(): number;
  /**
   * Read phase (the stage calls it before a frame's DOM writes): takes the layout reads this view
   * expects to need next, so they hit a clean layout. Text: caret geometry at the typed position.
   */
  measure?(): void;
  /** Settles when the layer's assets are decoded. */
  decode?(): Promise<void>;
  /** Called before the outer element is removed. */
  destroy(): void;
}

/** Clamps to [0, 1]; NaN becomes 0. */
export const clamp01 = (v: number): number => (v > 0 ? Math.min(v, 1) : 0);

/** Hermite smoothstep of `v` between edges a < b. */
export function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const px = (v: number): string => `${Number.isFinite(v) ? v : 0}px`;

/**
 * Positioning wrapper of a layer: `shell` sits at layer.box (with layer.transform and the reveal
 * opacity); when the layer has an ancestor clip, `outer` is an overflow-clipping wrapper at the
 * clip rect so the clip does not rotate with the layer.
 */
export class Shell {
  readonly outer: HTMLElement;
  readonly shell: HTMLElement;
  readonly #opacity: number;
  readonly #transform: string | null;
  #alpha = -1;
  #visible: boolean | null = null;
  #extra = "";

  constructor(env: MountEnv, layer: Layer, z: number) {
    const doc = env.doc;
    const b = layer.box;
    const shell = doc.createElement("div");
    shell.className = "sl-s";
    const clip = layer.clip;
    let ox = 0;
    let oy = 0;
    let outer = shell;
    if (clip && Number.isFinite(clip.x + clip.y + clip.w + clip.h)) {
      outer = doc.createElement("div");
      outer.className = "sl-k";
      const s = outer.style;
      s.left = px(clip.x);
      s.top = px(clip.y);
      s.width = px(Math.max(0, clip.w));
      s.height = px(Math.max(0, clip.h));
      ox = clip.x;
      oy = clip.y;
      outer.append(shell);
    }
    const s = shell.style;
    s.left = px(b.x - ox);
    s.top = px(b.y - oy);
    s.width = px(Math.max(0, b.w));
    s.height = px(Math.max(0, b.h));
    this.#transform = safeTransform(layer.transform);
    if (this.#transform) s.transform = this.#transform;
    outer.style.zIndex = String(Math.round(z));
    const o = layer.opacity;
    this.#opacity = typeof o === "number" && Number.isFinite(o) ? clamp01(o) : 1;
    outer.setAttribute("data-layer", layer.id);
    this.outer = outer;
    this.shell = shell;
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    if (v === this.#visible) return;
    this.#visible = v;
    this.outer.style.visibility = v ? "" : "hidden";
  }

  /** Reveal opacity factor (multiplied by layer.opacity). */
  alpha(a: number): void {
    const q = Math.round(clamp01(a) * 1000) / 1000;
    if (q === this.#alpha) return;
    this.#alpha = q;
    const v = q * this.#opacity;
    this.shell.style.opacity = v >= 1 ? "" : String(v);
  }

  /** Extra transform composed after layer.transform (stamp/scale reveals); "" clears. */
  extraTransform(t: string): void {
    if (t === this.#extra) return;
    this.#extra = t;
    const base = this.#transform ?? "";
    this.shell.style.transform = base && t ? `${base} ${t}` : base || t;
  }
}

/** Applies transient declarations and restores the values they replaced. */
export class Transient {
  readonly #saved = new Map<string, [string, string]>();

  apply(el: HTMLElement | SVGElement, css: CSSMap | null): void {
    const style = el.style;
    this.clear(el);
    if (!css || typeof css !== "object") return;
    for (const name of Object.keys(css)) {
      const v = css[name];
      if (!isSafeDeclaration(name, v)) continue;
      if (!this.#saved.has(name))
        this.#saved.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
      setDecl(style, name, v);
    }
  }

  get active(): boolean {
    return this.#saved.size > 0;
  }

  /** Names of the properties currently applied. */
  names(): IterableIterator<string> {
    return this.#saved.keys();
  }

  clear(el: HTMLElement | SVGElement): void {
    if (this.#saved.size === 0) return;
    const style = el.style;
    for (const [name, [v, pri]] of this.#saved) {
      if (v) style.setProperty(name, v, pri);
      else style.removeProperty(name);
    }
    this.#saved.clear();
  }
}

/** Creates the content element that fills the shell. */
export function contentDiv(doc: Document): HTMLDivElement {
  const el = doc.createElement("div");
  el.className = "sl-c";
  return el;
}

/** FNV-1a hash of a string (per-layer deterministic jitter). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Re-applies parsed style attributes through CSSOM (pages whose CSP blocks inline style attributes). */
export function reapplyStyleAttributes(root: Element): void {
  const els = root.querySelectorAll("[style]");
  for (let i = 0; i < els.length; i++) {
    const el = els[i] as HTMLElement;
    const text = el.getAttribute("style");
    if (text) el.style.cssText = text;
  }
}
