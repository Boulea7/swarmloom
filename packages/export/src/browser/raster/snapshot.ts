import { yieldTask } from "../schedule";
import { cssString, type FaceSource, type FontFaceCache, familiesOf, fontFaceRules, type WatchedFace } from "./fonts";
import { BLANK_IMAGE, type ResourceCache } from "./resources";
import { type InheritedValues, nativeControl, type StyleBaseline, styleText } from "./styles";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** HTML elements that draw nothing themselves. */
const SKIP_HTML = new Set([
  "script",
  "style",
  "link",
  "meta",
  "template",
  "noscript",
  "head",
  "title",
  "base",
  "source",
  "track",
  "audio",
  "object",
  "embed",
]);
/**
 * SVG elements left out: SMIL (the snapshot keeps the animated values it produced), and style
 * sheets and scripts. Every computed value is written inline, and a `<style>` copied into the one
 * snapshot document would apply to all of it, not only to the tree it was scoped to.
 */
const SKIP_SVG = new Set([
  "animate",
  "animateTransform",
  "animateMotion",
  "animateColor",
  "set",
  "discard",
  "style",
  "script",
]);
/** SMIL elements that animate a target. */
const SMIL_ANIMATIONS = "animate,set,animateMotion,animateTransform,animateColor";
/** Animated attributes whose DOM property has another name, or is a pair written as "x y". */
const ANIMATED_PROPS: ReadonlyMap<string, readonly string[]> = new Map([
  ["points", ["animatedPoints"]],
  ["in", ["in1"]],
  ["stdDeviation", ["stdDeviationX", "stdDeviationY"]],
  ["baseFrequency", ["baseFrequencyX", "baseFrequencyY"]],
  ["radius", ["radiusX", "radiusY"]],
]);
/** Motion targets get their whole local transform as `transform`, written over these. */
const MOTION_RESET = ["translate", "rotate", "scale", "offset-path"];
/** Attributes that never reach the snapshot: styling is rewritten, loading hints do not apply. */
const DROP_ATTRS = new Set([
  "style",
  "class",
  "srcset",
  "sizes",
  "loading",
  "decoding",
  "fetchpriority",
  "crossorigin",
  "referrerpolicy",
  "contenteditable",
  "tabindex",
  "inert",
  "popover",
  "hidden",
  "autofocus",
  "draggable",
  "nonce",
]);
const XML_NAME = /^[A-Za-z_][\w.-]*$/;
/** Characters XML 1.0 does not allow, and unpaired surrogates. */
const INVALID_XML =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: these are exactly the characters XML 1.0 forbids.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const CSS_URL = /url\("((?:[^"\\]|\\.)*)"\)/g;
const NON_ASCII = /[\u0080-\u{10ffff}]/u;
const NON_ASCII_ALL = /[\u0080-\u{10ffff}]/gu;
/**
 * Marks a resource in the markup until its data URL is known: a kind letter and an index between
 * private-use characters (they survive escaping). Kinds: "a" an attribute value, "i" the source of
 * an `<img>`, "c" a CSS `url()` in a style attribute, "s" one in a rule of the snapshot's sheet,
 * "k" the pixels of a canvas. `@font-face` rules are embedded on their own ({@link FontFaceCache}).
 */
const TOKEN = /\uE000([aciks])(\d+)\uE001/g;
/** HTML elements without content, so without `::before`/`::after` boxes worth reading. */
const VOID = new Set(["img", "input", "br", "hr", "wbr", "area", "col", "select", "textarea"]);
/**
 * Ink that may reach past the boxes a visibility check measures (shadows, outlines, blur, glyph
 * overhang), CSS px. Subtrees nearer to the viewport than this are always written.
 */
const INK_MARGIN = 256;
/** Displays whose box keeps its used size when written without its content. */
const HOLLOW_DISPLAYS = new Set(["block", "flow-root", "flex", "grid", "list-item"]);
/** Of those, the ones that hold their content's margins and floats in (block formatting contexts). */
const CONTAINED_DISPLAYS = new Set(["flow-root", "flex", "grid"]);
const SIDES = ["top", "right", "bottom", "left"] as const;
const RADII = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
/** Longest stretch of walking before the page gets the main thread back, ms. */
const SLICE_MS = 8;
/** Walks started over because the page changed between slices, before one runs without pausing. */
const MAX_RESTARTS = 2;

function escapeText(text: string): string {
  return text.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text)
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
}

/** Where the snapshot reads from. */
export interface SnapshotSource {
  document: Document;
  /** Viewport size, CSS px. */
  width: number;
  height: number;
  /** Shadow root of a host the watch below does not list (open roots are also read from the host). */
  shadowRootOf(host: Element): ShadowRoot | null;
  /**
   * Shadow roots attached so far, closed ones included (watched while the stage was built); read
   * again for every walk. Their style sheets may declare fonts.
   */
  shadowRoots(): Iterable<ShadowRoot>;
  /** Faces created through the FontFace API. */
  faces(): readonly WatchedFace[];
}

/** What one snapshot found worth reporting. */
export interface SnapshotStats {
  elements: number;
  /**
   * Subtrees left out, or written as an empty box of the same size, because nothing in them can
   * show: transparent, away from the viewport, or under a frame that covers it.
   */
  culled: number;
  /** Walks started over because the page changed while the walk paused. */
  restarts: number;
}

/**
 * A canvas drawn over the snapshot image rather than inside it (no PNG round trip): one of the
 * canvases painted last in the frame, with nothing but the others painted after it. CSS px of the
 * snapshot.
 */
export interface CanvasOverlay {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  /** What its ancestors and the viewport clip it to. */
  clip: Box;
}

/** One serialised frame. */
export interface FrameSnapshot {
  svg: string;
  /**
   * `svg` in three pieces: before its `@font-face` rules, the rules, and after them. The rules are
   * the same string object from frame to frame while the fonts stay the same, so whoever encodes
   * the image can encode them once.
   */
  parts: readonly [string, string, string];
  stats: SnapshotStats;
  /** Canvases to draw over the image, in paint order (a WebGL model, then the cursor layer). */
  overlays: CanvasOverlay[];
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * What SMIL animates beyond CSS properties (those reach the computed style): attribute names per
 * target, and the targets of `animateMotion`, whose motion only shows in their CTM.
 */
interface SmilTargets {
  attributes: Map<Element, Set<string>>;
  moving: Set<Element>;
}

/** A resource the markup refers to, by token index. */
interface ResourceUse {
  url: string;
  fallback?: () => string | null;
  /** Uses one shared definition can serve: `<img>` sources and CSS `url()` outside `@font-face`. */
  shared: number;
  /** Of those, the `<img>` sources. */
  images: number;
}

/** A canvas that may become a {@link CanvasOverlay}, and its token index. */
interface OverlayCandidate extends CanvasOverlay {
  index: number;
}

/** A flattened-tree ancestor in the frame document, as far as the overlay check needs it. */
interface PathEntry {
  el: Element;
  cs: CSSStyleDeclaration;
  /** Starts a stacking context (only cases that surely do: missing one is safe, adding one is not). */
  context: boolean;
  /** May start a stacking context (every case that does, and some that only might). */
  stacks: boolean;
  /**
   * Highest positive z-index of a box written so far in this stacking context, 0 when none: such
   * a box may paint over later boxes of a lower level.
   */
  raised: number;
}

/** Tells whether the documents read so far changed after the walk read them. */
interface ChangeWatch {
  observe(node: Document | ShadowRoot): void;
  changed(): boolean;
  stop(): void;
}

interface Walk {
  baseline: StyleBaseline;
  smil: SmilTargets;
  resources: ResourceCache;
  shadowRootOf: (host: Element) => ShadowRoot | null;
  out: string[];
  rules: string[];
  /** Fonts the walk saw asked for: computed `font-style|font-weight|font-stretch`, a newline, `font-family`. */
  fonts: Set<string>;
  /** Resources by token index, and the index of each URL. */
  urls: ResourceUse[];
  urlIndex: Map<string, number>;
  /** Canvas data URLs by token index; null while that canvas may still be drawn as an overlay. */
  canvases: (string | null)[];
  /** Canvases painted last so far, in paint order. */
  overlays: OverlayCandidate[];
  /** Ancestors of the element being written, in the frame document only. */
  path: PathEntry[];
  /** Elements whose background the canvas paints instead (see {@link emitDocument}). */
  onCanvas: Set<Element>;
  watch: ChangeWatch | null;
  /** `performance.now()` at which the walk pauses. */
  deadline: number;
  stats: SnapshotStats;
  nextClass: number;
}

/** Per-frame state of one document (the frame itself or the live page inside it). */
interface DocView {
  win: Window & typeof globalThis;
  viewport: Box;
  /** The viewport widened by {@link INK_MARGIN}: where a box may still show. */
  reach: Box;
  /** The frame document itself (not a page inside it). */
  top: boolean;
}

/** Steps of a walk: each `yield` hands the main thread back until the walk resumes. */
type Steps = Generator<void, void, void>;

function docView(win: Window & typeof globalThis, width: number, height: number, top: boolean): DocView {
  return {
    win,
    viewport: { left: 0, top: 0, right: width, bottom: height },
    reach: { left: -INK_MARGIN, top: -INK_MARGIN, right: width + INK_MARGIN, bottom: height + INK_MARGIN },
    top,
  };
}

/**
 * A token for a resource URL, resolved after the walk (see {@link TOKEN} for the kinds). URLs used
 * more than once in shareable places are defined once in the sheet: a page bitmap cropped into
 * many layers would otherwise be inlined in every one of them.
 */
function embedUrl(walk: Walk, url: string, kind: "a" | "i" | "c" | "s", fallback?: () => string | null): string {
  if (!url || url.startsWith("#")) return url;
  let index = walk.urlIndex.get(url);
  if (index === undefined) {
    index = walk.urls.length;
    walk.urlIndex.set(url, index);
    walk.urls.push({ url, fallback, shared: 0, images: 0 });
  }
  const use = walk.urls[index] as ResourceUse;
  use.fallback ??= fallback;
  if (kind === "i" || kind === "c" || kind === "s") use.shared++;
  if (kind === "i") use.images++;
  return `\uE000${kind}${index}\uE001`;
}

/** Tokens for the `url()`s of a CSS value written in a style attribute ("c") or a rule ("s"). */
function embedCssUrls(walk: Walk, value: string, kind: "c" | "s"): string {
  if (!value.includes("url(")) return value;
  return value.replace(CSS_URL, (match, raw: string) => {
    const url = raw.includes("\\") ? raw.replace(/\\(.)/g, "$1") : raw;
    if (!url || url.startsWith("#")) return match;
    return embedUrl(walk, url, kind);
  });
}

function px(cs: CSSStyleDeclaration, name: string): number {
  return Number.parseFloat(cs.getPropertyValue(name)) || 0;
}

/** Numeric z-index, or null for `auto`. */
function zIndex(cs: CSSStyleDeclaration): number | null {
  const z = Number.parseInt(cs.getPropertyValue("z-index"), 10);
  return Number.isFinite(z) ? z : null;
}

/**
 * True when nothing of the flattened subtree of `el` can show: every box in it, widened by what
 * overflows it unclipped (text, pseudo-elements), lies outside `view.reach`, and it holds no SVG
 * element with an id (a gradient, symbol or clip path something visible may refer to). Below a
 * positioned box that clips its content and lies outside, nothing is read. With `floats`, a
 * floating box in it also counts as showing: it can move content that follows `el`. Reads boxes
 * and a few styles, a small fraction of what writing the subtree costs.
 */
function offscreen(walk: Walk, el: Element, view: DocView, floats: boolean): boolean {
  const area = view.reach;
  const near = (left: number, top: number, right: number, bottom: number) =>
    right >= area.left && left <= area.right && bottom >= area.top && top <= area.bottom;
  const stack: Element[] = [el];
  for (let next = stack.pop(); next; next = stack.pop()) {
    if (next.namespaceURI === SVG_NS && next.id) return false;
    const r = next.getBoundingClientRect();
    if (near(r.left, r.top, r.right, r.bottom)) {
      // A box sitting at the origin may be no box at all (display: none or contents).
      const boxless = r.width === 0 && r.height === 0 && r.x === 0 && r.y === 0 && next.getClientRects().length === 0;
      if (!boxless) return false;
    }
    const cs = view.win.getComputedStyle(next);
    if (floats && next !== el && cs.getPropertyValue("float") !== "none") return false;
    const box = next as HTMLElement;
    const openX = cs.getPropertyValue("overflow-x") === "visible";
    const openY = cs.getPropertyValue("overflow-y") === "visible";
    if (box.offsetWidth > 0 || box.offsetHeight > 0) {
      const right = openX
        ? r.right + Math.max(0, box.scrollWidth - box.clientWidth) * (r.width / box.offsetWidth || 1)
        : r.right;
      const bottom = openY
        ? r.bottom + Math.max(0, box.scrollHeight - box.clientHeight) * (r.height / box.offsetHeight || 1)
        : r.bottom;
      if (near(r.left, r.top, right, bottom)) return false;
    }
    // Its content is clipped to it (fixed-position content would escape; such pages are rare).
    if (!openX && !openY && cs.getPropertyValue("position") !== "static") continue;
    // A frame's document stays inside the frame's box.
    if (next.localName === "iframe") continue;
    const children = flatChildren(walk, next);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as Node;
      if (child.nodeType === 1) stack.push(child as Element);
    }
  }
  return true;
}

function stepsCounter(cs: CSSStyleDeclaration): boolean {
  return cs.getPropertyValue("counter-increment") !== "none" || cs.getPropertyValue("counter-set") !== "none";
}

/**
 * Whether an element of the flattened subtrees of `nodes`, or one of its `::before`/`::after`
 * boxes, increments or sets a counter. Generated content after them may show that counter, and the
 * snapshot's clones count again: leaving them out would change the numbers. Resets are fine, a
 * counter reset inside a subtree is not seen after it.
 */
function stepsCounters(walk: Walk, nodes: readonly Node[], view: DocView): boolean {
  const stack = nodes.filter((node): node is Element => node.nodeType === 1).reverse();
  for (let next = stack.pop(); next; next = stack.pop()) {
    const cs = view.win.getComputedStyle(next);
    if (cs.getPropertyValue("display") === "none") continue;
    if (stepsCounter(cs)) return true;
    for (const pseudo of ["::before", "::after"] as const) {
      const ps = view.win.getComputedStyle(next, pseudo);
      const content = ps.getPropertyValue("content");
      if (content && content !== "none" && content !== "normal" && stepsCounter(ps)) return true;
    }
    // A frame's document counts on its own.
    if (next.localName === "iframe") continue;
    const children = flatChildren(walk, next);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as Node;
      if (child.nodeType === 1) stack.push(child as Element);
    }
  }
  return false;
}

/**
 * An absolutely positioned subtree that cannot show: fully transparent, or with nothing in it near
 * the viewport. Leaving it out cannot move anything else (it is out of flow), unless it counts.
 */
function culled(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView): boolean {
  const position = cs.getPropertyValue("position");
  if (position !== "absolute" && position !== "fixed") return false;
  const hidden = cs.getPropertyValue("opacity") === "0" || offscreen(walk, el, view, false);
  return hidden && !stepsCounters(walk, [el], view);
}

/**
 * Whether `el` may be written as an empty box: an in-flow block whose children are all away from
 * the viewport, in a layout where its content moves nothing else. Its used size is written anyway
 * (computed width and height), so what follows keeps its place, provided the box does not share
 * margins or floats with its content (it is a block formatting context, or has border or padding
 * on both edges and no floats inside), no baseline is read from it and its content steps no
 * counter. Off-screen sections of a long live page then cost one element each.
 *
 * @param context The parent lays its children out in block flow, or in a flex or grid container
 *   that aligns nothing by baseline, and its own baseline positions nothing.
 */
function hollowable(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView, context: boolean): boolean {
  const local = el.localName;
  if (!context || VOID.has(local) || local === "canvas" || local === "video" || local === "iframe") return false;
  const display = cs.getPropertyValue("display");
  const position = cs.getPropertyValue("position");
  if (!HOLLOW_DISPLAYS.has(display) || (position !== "static" && position !== "relative")) return false;
  if (cs.getPropertyValue("float") !== "none" || cs.getPropertyValue("align-self").includes("baseline")) return false;
  if (!cs.getPropertyValue("width").endsWith("px") || !cs.getPropertyValue("height").endsWith("px")) return false;
  const overflow = cs.getPropertyValue("overflow-x");
  const contained =
    CONTAINED_DISPLAYS.has(display) ||
    (overflow !== "visible" && overflow !== "clip") ||
    /\b(?:layout|paint|strict|content)\b/.test(cs.getPropertyValue("contain"));
  if (!contained) {
    const edge = (side: "top" | "bottom") => px(cs, `border-${side}-width`) > 0 || px(cs, `padding-${side}`) > 0;
    if (!edge("top") || !edge("bottom")) return false;
  }
  if (el.getBoundingClientRect().height <= 0) return false;
  // The box keeps its own counters and pseudo-elements, its content's would go.
  return offscreen(walk, el, view, !contained) && !stepsCounters(walk, flatChildren(walk, el), view);
}

/** Whether the children of a box with this style sit in a layout {@link hollowable} accepts. */
function hollowContext(cs: CSSStyleDeclaration): boolean {
  const display = cs.getPropertyValue("display");
  if (display === "block" || display === "flow-root" || display === "list-item") return true;
  return (display === "flex" || display === "grid") && !cs.getPropertyValue("align-items").includes("baseline");
}

/**
 * Paints its box as laid out, axis-aligned: no transparency, blending, clipping, masking or
 * rotation (scale and translation only move the box, which its client rect shows).
 */
function plainPaint(cs: CSSStyleDeclaration): boolean {
  if (cs.getPropertyValue("opacity") !== "1" || cs.getPropertyValue("filter") !== "none") return false;
  if (cs.getPropertyValue("mix-blend-mode") !== "normal" || cs.getPropertyValue("clip-path") !== "none") return false;
  if (cs.getPropertyValue("mask-image") !== "none" || cs.getPropertyValue("rotate") !== "none") return false;
  if (cs.getPropertyValue("clip") !== "auto" || cs.getPropertyValue("visibility") !== "visible") return false;
  const transform = cs.getPropertyValue("transform");
  return transform === "none" || /^matrix\([^,]+, 0, 0, [^,]+, [^,]+, [^,]+\)$/.test(transform);
}

function roundedCorners(cs: CSSStyleDeclaration): boolean {
  return RADII.some((corner) => cs.getPropertyValue(`border-${corner}-radius`) !== "0px");
}

/** Index of the frame among `children` that covers the viewport and paints last, and its z-index. */
interface Cover {
  index: number;
  z: number;
}

/**
 * A same-origin frame among `children` whose document box covers the whole viewport, or null. The
 * snapshot always draws a frame's document over a solid background, so siblings that keep their
 * subtree in a stacking context painted before it cannot show (the render page's stage under the
 * live page it went live to).
 */
function coveringFrame(children: readonly Node[], view: DocView): Cover | null {
  let found: Cover | null = null;
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as Element;
    if (node.nodeType !== 1 || node.localName !== "iframe" || node.namespaceURI !== XHTML_NS) continue;
    const z = frameCover(node as HTMLIFrameElement, view);
    if (z !== null && (found === null || z >= found.z)) found = { index: i, z };
  }
  return found;
}

/** The z-index (auto as 0) of a positioned frame whose opaque document box covers the viewport, or null. */
function frameCover(frame: HTMLIFrameElement, view: DocView): number | null {
  const cs = view.win.getComputedStyle(frame);
  if (cs.getPropertyValue("position") === "static" || !plainPaint(cs) || roundedCorners(cs)) return null;
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return null;
  }
  const win = doc?.defaultView;
  if (!doc?.documentElement || !win || frame.offsetWidth <= 0 || frame.offsetHeight <= 0) return null;
  const bg = canvasColor(win, backgroundOwner(doc, win));
  if (bg !== "#fff" && !bg.startsWith("rgb(")) return null;
  // The document box (see emitFrame): at the padding edge, clientWidth x clientHeight, clipped to
  // the padding box.
  const r = frame.getBoundingClientRect();
  const sx = r.width / frame.offsetWidth;
  const sy = r.height / frame.offsetHeight;
  const bl = px(cs, "border-left-width");
  const bt = px(cs, "border-top-width");
  const v = view.viewport;
  const e = 0.01;
  if (r.left + (bl + px(cs, "padding-left")) * sx > v.left + e) return null;
  if (r.top + (bt + px(cs, "padding-top")) * sy > v.top + e) return null;
  if (r.left + (bl + frame.clientWidth) * sx < v.right - e) return null;
  if (r.top + (bt + frame.clientHeight) * sy < v.bottom - e) return null;
  return zIndex(cs) ?? 0;
}

/** Whether sibling `el` at `index` paints, subtree and all, before the covering frame. */
function underCover(el: Element, index: number, cover: Cover, view: DocView): boolean {
  const cs = view.win.getComputedStyle(el);
  const position = cs.getPropertyValue("position");
  const z = zIndex(cs);
  // Fixed and sticky boxes always keep their subtree in their own stacking context.
  if (position !== "fixed" && position !== "sticky" && (position === "static" || z === null)) return false;
  const level = z ?? 0;
  return level < cover.z || (level === cover.z && index < cover.index);
}

/** Starts a stacking context, in the cases that surely do. */
function stackingContext(cs: CSSStyleDeclaration): boolean {
  const position = cs.getPropertyValue("position");
  if (position === "fixed" || position === "sticky") return true;
  if (position !== "static" && zIndex(cs) !== null) return true;
  return (
    cs.getPropertyValue("opacity") !== "1" ||
    cs.getPropertyValue("transform") !== "none" ||
    cs.getPropertyValue("filter") !== "none" ||
    cs.getPropertyValue("isolation") === "isolate" ||
    cs.getPropertyValue("mix-blend-mode") !== "normal"
  );
}

/** Whether an element's own box draws anything (its children are checked on their own). */
function paintsBox(cs: CSSStyleDeclaration, special: boolean): boolean {
  if (special) return true;
  if (cs.getPropertyValue("visibility") !== "visible") return false;
  const bg = cs.getPropertyValue("background-color");
  if (bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return true;
  if (cs.getPropertyValue("background-image") !== "none" || cs.getPropertyValue("box-shadow") !== "none") return true;
  if (cs.getPropertyValue("outline-style") !== "none" || cs.getPropertyValue("backdrop-filter") !== "none") return true;
  return SIDES.some((side) => {
    const style = cs.getPropertyValue(`border-${side}-style`);
    return style !== "none" && style !== "hidden" && px(cs, `border-${side}-width`) > 0;
  });
}

/** Writes the overlay candidates' pixels into the snapshot after all: something paints over them. */
function dropOverlays(walk: Walk): void {
  for (const overlay of walk.overlays) walk.canvases[overlay.index] = canvasDataUrl(overlay.canvas);
  walk.overlays = [];
}

/** Contains fixed-position descendants (their containing block), in the cases that surely do. */
function holdsFixed(cs: CSSStyleDeclaration): boolean {
  return (
    cs.getPropertyValue("transform") !== "none" ||
    cs.getPropertyValue("perspective") !== "none" ||
    cs.getPropertyValue("filter") !== "none" ||
    cs.getPropertyValue("backdrop-filter") !== "none" ||
    /\b(?:layout|paint|strict|content)\b/.test(cs.getPropertyValue("contain"))
  );
}

/**
 * Scaled and moved at most, never flipped ({@link plainPaint} allows a negative scale) or moved
 * along a path: the box then shows its content the right way round where its client rect says.
 */
function upright(cs: CSSStyleDeclaration): boolean {
  const m = /^matrix\(([^,]+), 0, 0, ([^,]+),/.exec(cs.getPropertyValue("transform"));
  if (m && !(Number(m[1]) > 0 && Number(m[2]) > 0)) return false;
  const scale = cs.getPropertyValue("scale");
  if (scale !== "none" && !scale.split(/\s+/).every((v) => Number.parseFloat(v) > 0)) return false;
  return cs.getPropertyValue("offset-path") === "none";
}

/** May start a stacking context: every case that does, and some that only might. */
function mayStack(cs: CSSStyleDeclaration): boolean {
  if (stackingContext(cs) || zIndex(cs) !== null || cs.getPropertyValue("will-change") !== "auto") return true;
  if (/\b(?:layout|paint|strict|content)\b/.test(cs.getPropertyValue("contain"))) return true;
  if (cs.getPropertyValue("container-type") !== "normal") return true;
  return [
    "translate",
    "rotate",
    "scale",
    "backdrop-filter",
    "perspective",
    "clip-path",
    "mask-image",
    "offset-path",
    "view-transition-name",
  ].some((name) => cs.getPropertyValue(name) !== "none");
}

/**
 * The level at which the box of `cs` paints in the stacking context around it, when it starts
 * one of its own: its z-index when positioned, else 0. 0 is never above the true level here, as
 * negative z-indexes are refused before.
 */
function stackLevel(cs: CSSStyleDeclaration): number {
  return cs.getPropertyValue("position") === "static" ? 0 : (zIndex(cs) ?? 0);
}

/**
 * The canvas as an overlay candidate, or null: in the frame document, positioned, drawn as is
 * (no border, padding, transparency, blending, rotation or flip, itself or above it; scale and
 * translation only), clipped only by rectangles, and in every stacking context it sits in, at a
 * level no box written before it rises above. Whether anything paints after it is known once
 * the walk ends.
 */
function overlayOf(
  walk: Walk,
  canvas: HTMLCanvasElement,
  cs: CSSStyleDeclaration,
  view: DocView,
): CanvasOverlay | null {
  if (!view.top || canvas.width === 0 || canvas.height === 0) return null;
  const position = cs.getPropertyValue("position");
  if (position === "static" || (zIndex(cs) ?? 0) < 0) return null;
  if (!plainPaint(cs) || !upright(cs) || cs.getPropertyValue("object-fit") !== "fill") return null;
  if (SIDES.some((side) => px(cs, `border-${side}-width`) > 0 || px(cs, `padding-${side}`) > 0)) return null;
  const clip = { ...view.viewport };
  // Overflow clips what has its containing block inside the clipping box: walking up, an
  // absolutely positioned box skips static ancestors, a fixed one all but those that contain it.
  let mode = position;
  // The level of the canvas's branch in the stacking context of the entry being looked at: that
  // of the outermost box below it that may start a context of its own, else the canvas's.
  let level = stackLevel(cs);
  for (let i = walk.path.length - 1; i >= 0; i--) {
    const { el, cs: style, raised, stacks } = walk.path[i] as PathEntry;
    // A box of a higher level written before paints over the canvas.
    if (raised > level) return null;
    if (stacks) level = stackLevel(style);
    // Transparency, filters and masks apply to every descendant, containing block or not; with
    // will-change, whether it contains the canvas is unclear.
    if (!plainPaint(style) || !upright(style) || (zIndex(style) ?? 0) < 0) return null;
    if (style.getPropertyValue("will-change") !== "auto") return null;
    const ancestorPosition = style.getPropertyValue("position");
    const contains =
      mode === "fixed"
        ? holdsFixed(style)
        : mode === "absolute"
          ? ancestorPosition !== "static" || holdsFixed(style)
          : true;
    if (!contains) continue;
    mode = ancestorPosition;
    const contain = /\b(?:paint|strict|content)\b/.test(style.getPropertyValue("contain"));
    const clipX = contain || style.getPropertyValue("overflow-x") !== "visible";
    const clipY = contain || style.getPropertyValue("overflow-y") !== "visible";
    if (!clipX && !clipY) continue;
    if (roundedCorners(style) || style.getPropertyValue("overflow-clip-margin") !== "0px") return null;
    const r = el.getBoundingClientRect();
    // Borders in CSS px of the viewport: the client rect is scaled with the box, its borders too.
    const box = el as HTMLElement;
    const kx = box.offsetWidth > 0 ? r.width / box.offsetWidth : 1;
    const ky = box.offsetHeight > 0 ? r.height / box.offsetHeight : 1;
    if (clipX) {
      clip.left = Math.max(clip.left, r.left + px(style, "border-left-width") * kx);
      clip.right = Math.min(clip.right, r.right - px(style, "border-right-width") * kx);
    }
    if (clipY) {
      clip.top = Math.max(clip.top, r.top + px(style, "border-top-width") * ky);
      clip.bottom = Math.min(clip.bottom, r.bottom - px(style, "border-bottom-width") * ky);
    }
  }
  const r = canvas.getBoundingClientRect();
  return { canvas, x: r.left, y: r.top, width: r.width, height: r.height, clip };
}

/** The `src` of a canvas clone: its pixels, or a token while it may be drawn over the snapshot instead. */
function canvasSource(walk: Walk, canvas: HTMLCanvasElement, overlay: CanvasOverlay | null): string {
  if (!overlay) return canvasDataUrl(canvas);
  const index = walk.canvases.push(null) - 1;
  walk.overlays.push({ ...overlay, index });
  return `\uE000k${index}\uE001`;
}

/** `translate` value that adds an offset to the element's own `translate`. */
function shiftedTranslate(current: string, dx: number, dy: number): string {
  const parts = current === "none" ? [] : current.split(/\s+/);
  const x = Number.parseFloat(parts[0] ?? "0") || 0;
  const y = Number.parseFloat(parts[1] ?? "0") || 0;
  const z = parts[2] ? ` ${parts[2]}` : "";
  return `${x + dx}px ${y + dy}px${z}`;
}

function canvasDataUrl(canvas: HTMLCanvasElement): string {
  try {
    return canvas.width > 0 && canvas.height > 0 ? canvas.toDataURL("image/png") : BLANK_IMAGE;
  } catch {
    return BLANK_IMAGE;
  }
}

/** Whether a video has a frame to show. */
function hasFrame(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0;
}

/**
 * Whether a video shows its poster: it has one, and no frame yet, or it has neither played nor
 * moved from the start (a seek to the start shows the frame on the page; it cannot be told apart).
 */
function showsPoster(video: HTMLVideoElement): boolean {
  if (!video.poster) return false;
  return !hasFrame(video) || (video.paused && video.played.length === 0 && video.currentTime === 0);
}

/**
 * The `src` (or shared class) of an `<img>` showing what a video shows: its poster, else its current
 * frame as a PNG, else nothing. A frame from another site cannot be read and is left blank.
 */
function videoSource(walk: Walk, video: HTMLVideoElement): string {
  if (showsPoster(video)) return embedUrl(walk, video.poster, "i");
  if (!hasFrame(video)) return ` src="${BLANK_IMAGE}"`;
  const canvas = video.ownerDocument.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  try {
    return ` src="${canvas.toDataURL("image/png")}"`;
  } catch {
    const url = video.currentSrc;
    const name = url.length > 80 ? `${url.slice(0, 77)}...` : url;
    walk.resources.report(
      `The video ${name} could not be drawn in the frame (another site without CORS); it is left blank`,
    );
    return ` src="${BLANK_IMAGE}"`;
  }
}

/** Seconds as the media controls show them: m:ss, or h:mm:ss from an hour on. */
function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const ss = String(s % 60).padStart(2, "0");
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Opacity of the controls' shade by offset from its top edge, 110 px above the bottom. */
const SHADE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.18, 0.09],
  [0.36, 0.3],
  [0.55, 0.6],
  [0.73, 0.86],
  [0.91, 0.99],
  [1, 1],
];

/**
 * Chromium's media controls over a paused video, `w` x `h` CSS px, as inline SVG: the shade along
 * the bottom, play button, time, volume, fullscreen and menu buttons and the timeline, on a dark
 * backdrop when there is no picture. The browser draws them in a shadow tree no page can read, so
 * this is a likeness: buttons greyed until the video has loaded its metadata. Inline SVG, rather
 * than another SVG image, also draws in Firefox inside the frame's own SVG image.
 */
function controlsSvg(video: HTMLVideoElement, w: number, h: number, picture: boolean, box: string, id: string): string {
  const buttons = video.readyState >= 1 ? "" : ' opacity="0.3"';
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const clock = clockText(video.currentTime);
  const time = duration > 0 ? `${clock} / ${clockText(duration)}` : clock;
  const played = duration > 0 ? Math.min(1, video.currentTime / duration) * (w - 32) : 0;
  // The middle of the buttons' row.
  const y = h - 48;
  const stops = SHADE.map(([o, a]) => `<stop offset="${o}" stop-opacity="${a}"/>`).join("");
  const svg = [
    `<svg xmlns="${SVG_NS}" data-sl-controls="" width="${w}" height="${h}" style="${box}">`,
    `<linearGradient id="${id}" x2="0" y2="1">${stops}</linearGradient>`,
    picture ? "" : '<rect width="100%" height="100%" fill="#333"/>',
    `<rect y="${h - 110}" width="100%" height="110" fill="url(#${id})"/>`,
    `<g fill="#fff"${buttons}>`,
    `<path d="M20 ${y - 5.5}L29.5 ${y}L20 ${y + 5.5}z"/>`,
    `<path d="M${w - 128} ${y - 3}h3l4.5-4v14l-4.5-4h-3z"/>`,
    [-5, 0, 5].map((dy) => `<circle cx="${w - 24}" cy="${y + dy}" r="1.75"/>`).join(""),
    '<g fill="none" stroke="#fff" stroke-width="1.5">',
    `<path d="M${w - 118} ${y - 3}a4 4 0 0 1 0 6M${w - 116} ${y - 6}a7 7 0 0 1 0 12"/>`,
    `<path d="M${w - 77} ${y - 2}v-4h4M${w - 71} ${y - 6}h4v4M${w - 67} ${y + 2}v4h-4M${w - 73} ${y + 6}h-4v-4"/>`,
    "</g></g>",
    `<text x="48" y="${y + 5}" font-family="Roboto,Arial,sans-serif" font-size="14" fill="#fff">${time}</text>`,
    `<rect x="16" y="${h - 24}" width="${Math.max(0, w - 32)}" height="4" rx="2" fill="#fff" fill-opacity="0.3"/>`,
    played > 0 ? `<rect x="16" y="${h - 24}" width="${played}" height="4" rx="2" fill="#fff"/>` : "",
    "</svg>",
  ].join("");
  return svg;
}

/**
 * The inside of a video's box when it shows its controls: the picture (`source`, see
 * {@link videoSource}) fitted into the content box as the video fits it, and the controls over it.
 */
function videoPlayer(walk: Walk, video: HTMLVideoElement, cs: CSSStyleDeclaration, source: string): string {
  const left = px(cs, "padding-left");
  const top = px(cs, "padding-top");
  const w = Math.max(0, video.clientWidth - left - px(cs, "padding-right"));
  const h = Math.max(0, video.clientHeight - top - px(cs, "padding-bottom"));
  const box = `display:block;position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
  const fit = `object-fit:${cs.getPropertyValue("object-fit")};object-position:${cs.getPropertyValue("object-position")}`;
  const picture = showsPoster(video) || hasFrame(video);
  return (
    (picture ? `<img${source} style="${escapeAttr(`${box};${fit}`)}"/>` : "") +
    controlsSvg(video, w, h, picture, box, `sl${walk.nextClass++}`)
  );
}

/** Draws a loaded image into a PNG data URL; used when its URL cannot be fetched. */
function imageFallback(img: HTMLImageElement): () => string | null {
  return () => {
    if (!img.complete || img.naturalWidth === 0) return null;
    const canvas = img.ownerDocument.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  };
}

/** Records the targets of the SMIL animations in an outermost `<svg>` (and the svg itself). */
function collectSmil(found: SmilTargets, svg: Element): void {
  for (const anim of Array.from(svg.querySelectorAll(SMIL_ANIMATIONS))) {
    if (anim.namespaceURI !== SVG_NS) continue;
    const target = (anim as SVGAnimationElement).targetElement;
    if (!target) continue;
    if (anim.localName === "animateMotion") {
      found.moving.add(target);
      continue;
    }
    const attribute = anim.getAttribute("attributeName")?.trim();
    if (!attribute || anim.getAttribute("attributeType") === "CSS") continue;
    const name = attribute.replace(/^xlink:/, "");
    const names = found.attributes.get(target) ?? new Set<string>();
    names.add(name);
    found.attributes.set(target, names);
  }
}

/** Items of an SVG list as text. */
function listText<T>(list: { numberOfItems: number; getItem(index: number): T }, text: (item: T) => string): string {
  const out: string[] = [];
  for (let i = 0; i < list.numberOfItems; i++) out.push(text(list.getItem(i)));
  return out.join(" ");
}

/** Animated value of one SVG DOM property as attribute text, or null for keyword types. */
function animatedText(owner: unknown): string | null {
  if (!owner || typeof owner !== "object") return null;
  const anim = (owner as { animVal?: unknown }).animVal;
  // Type tags, not instanceof: the element may belong to another frame's realm.
  switch (Object.prototype.toString.call(owner).slice(8, -1)) {
    case "SVGAnimatedLength":
      return (anim as SVGLength).valueAsString;
    case "SVGAnimatedNumber":
    case "SVGAnimatedInteger":
    case "SVGAnimatedBoolean":
    case "SVGAnimatedString":
      return String(anim);
    case "SVGAnimatedRect": {
      const rect = anim as DOMRectReadOnly | null;
      return rect ? `${rect.x} ${rect.y} ${rect.width} ${rect.height}` : null;
    }
    case "SVGAnimatedLengthList":
      return listText(anim as SVGLengthList, (length) => length.valueAsString);
    case "SVGAnimatedNumberList":
      return listText(anim as SVGNumberList, (number) => String(number.value));
    case "SVGAnimatedTransformList":
      return listText(anim as SVGTransformList, ({ matrix: m }) => `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    case "SVGPointList":
      return listText(owner as SVGPointList, (point) => `${point.x},${point.y}`);
    default:
      // Enumerations, preserveAspectRatio and angles keep their base value.
      return null;
  }
}

/**
 * Animated values of the attributes SMIL animates on `el`: the attribute itself holds the base
 * value, only the DOM property's `animVal` (or `animatedPoints`) has the current one.
 */
function animatedAttributes(walk: Walk, el: Element): Map<string, string> {
  const values = new Map<string, string>();
  for (const name of walk.smil.attributes.get(el) ?? []) {
    const parts = (ANIMATED_PROPS.get(name) ?? [name]).map((prop) => animatedText(Reflect.get(el, prop)));
    if (parts.every((part) => part !== null)) values.set(name, parts.join(" "));
  }
  return values;
}

/** Local transform of an `animateMotion` target, motion included, as a CSS `matrix()`. */
function motionMatrix(el: Element): string | null {
  const self = el as Partial<SVGGraphicsElement>;
  const parent = el.parentNode as Partial<SVGGraphicsElement> | null;
  if (typeof self.getScreenCTM !== "function" || typeof parent?.getScreenCTM !== "function") return null;
  try {
    const inner = self.getScreenCTM.call(el);
    const outer = parent.getScreenCTM.call(parent);
    if (!inner || !outer) return null;
    const m = outer.inverse().multiply(inner);
    const values = [m.a, m.b, m.c, m.d, m.e, m.f];
    if (!values.every(Number.isFinite)) return null;
    return `matrix(${values.map((v) => Math.round(v * 1e6) / 1e6).join(",")})`;
  } catch {
    // A parent scaled to nothing has no inverse (some engines throw); it draws nothing either.
    return null;
  }
}

/** Attributes of a clone, with resource URLs embedded and live form state written back. */
function attributes(walk: Walk, el: Element): string {
  const out: string[] = [];
  const svg = el.namespaceURI === SVG_NS;
  const local = el.localName;
  const animated = svg ? animatedAttributes(walk, el) : null;
  const input = local === "input" && !svg ? (el as HTMLInputElement) : null;
  const liveValue = input !== null && input.type !== "file" && input.type !== "password";
  const option = local === "option" && !svg ? (el as HTMLOptionElement) : null;
  for (const attr of Array.from(el.attributes)) {
    let name = attr.name;
    if (attr.namespaceURI === XLINK_NS && attr.localName === "href") {
      // SVG 2: a plain `href` wins, and writing both as `href` would make the SVG ill-formed.
      if (el.hasAttributeNS(null, "href")) continue;
      name = "href";
    } else if (attr.namespaceURI === XML_NS) name = `xml:${attr.localName}`;
    else if (attr.namespaceURI || !XML_NAME.test(name)) continue;
    if (DROP_ATTRS.has(name) || name.startsWith("on") || name === "xmlns") continue;
    // Live form state is written below; the authored attribute too would be a duplicate, which
    // makes the SVG ill-formed.
    if ((liveValue && name === "value") || (input && name === "checked") || (option && name === "selected")) continue;
    let value = animated?.get(name) ?? attr.value;
    animated?.delete(name);
    if (name === "src" && (local === "img" || local === "iframe" || local === "video")) continue;
    if (svg && name === "href" && local === "image") value = embedUrl(walk, value, "a");
    out.push(` ${name}="${escapeAttr(value)}"`);
  }
  // Attributes only an animation sets.
  for (const [name, animatedValue] of animated ?? []) {
    if (!XML_NAME.test(name) || DROP_ATTRS.has(name) || name.startsWith("on")) continue;
    const value = name === "href" && local === "image" ? embedUrl(walk, animatedValue, "a") : animatedValue;
    out.push(` ${name}="${escapeAttr(value)}"`);
  }
  if (liveValue) out.push(` value="${escapeAttr(input.value)}"`);
  if (input?.checked) out.push(' checked="checked"');
  if (option?.selected) out.push(' selected="selected"');
  return out.join("");
}

/**
 * Children in the flattened tree: the shadow tree of a host, the assigned nodes of a slot. Watched
 * roots cover closed ones; open roots the watch never saw (declarative shadow DOM, the live page's
 * own realm) are read from the host.
 */
function flatChildren(walk: Walk, el: Element): readonly Node[] {
  const root = walk.shadowRootOf(el) ?? el.shadowRoot;
  if (root) return Array.from(root.childNodes);
  if (el.localName === "slot" && el.namespaceURI === XHTML_NS) {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return Array.from(el.childNodes);
}

/**
 * `::before` / `::after` of `el` as a rule on a class of the clone, or null when it has none. Those
 * of an empty box away from the viewport (`hollow`) keep only what sets their size and place, and
 * their counters.
 */
function pseudoRules(
  walk: Walk,
  el: Element,
  view: DocView,
  inherited: InheritedValues,
  hollow: boolean,
): string | null {
  const props = hollow ? walk.baseline.layout : walk.baseline.props;
  let cls: string | null = null;
  for (const pseudo of ["::before", "::after"] as const) {
    const ps = view.win.getComputedStyle(el, pseudo);
    const content = ps.getPropertyValue("content");
    if (!content || content === "none" || content === "normal") continue;
    cls ??= `sl${walk.nextClass++}`;
    const { text } = styleText(walk.baseline, ps, inherited, undefined, props);
    if (!hollow) useFonts(walk, ps);
    walk.rules.push(`.${cls}${pseudo}{${embedCssUrls(walk, text, "s")};content:${embedCssUrls(walk, content, "s")}}`);
  }
  return cls;
}

/** Records the fonts the text of a box may be drawn in. */
function useFonts(walk: Walk, cs: CSSStyleDeclaration): void {
  const face = `${cs.getPropertyValue("font-style")}|${cs.getPropertyValue("font-weight")}|${cs.getPropertyValue("font-stretch")}`;
  walk.fonts.add(`${face}\n${cs.getPropertyValue("font-family")}`);
}

/** Emits a text node, shifted when its parent is a scrolled container. */
function emitText(walk: Walk, node: Node, shift: { x: number; y: number } | null): void {
  const text = escapeText(node.nodeValue ?? "");
  if (!text) return;
  if (walk.overlays.length > 0 && text.trim()) dropOverlays(walk);
  if (shift) walk.out.push(`<span style="position:relative;left:${shift.x}px;top:${shift.y}px">${text}</span>`);
  else walk.out.push(text);
}

/** Records a box of z-index `z` > 0 in the stacking context it sits in (the frame document only). */
function raise(walk: Walk, z: number): void {
  for (let i = walk.path.length - 1; i >= 0; i--) {
    const entry = walk.path[i] as PathEntry;
    if (entry.context) {
      entry.raised = Math.max(entry.raised, z);
      return;
    }
  }
}

/**
 * Emits one element and its flattened subtree, pausing (`yield`) whenever the slice is used up.
 *
 * @param context Whether its parent lets it be written hollow (see {@link hollowable}).
 */
function* emitElement(
  walk: Walk,
  el: Element,
  view: DocView,
  parent: InheritedValues | null,
  parentNs: string,
  shift: { x: number; y: number } | null,
  context: boolean,
): Steps {
  if (performance.now() >= walk.deadline) yield;
  const ns = el.namespaceURI ?? XHTML_NS;
  const local = el.localName;
  const svg = ns === SVG_NS;
  if (ns === XHTML_NS && SKIP_HTML.has(local)) return;
  if (svg && SKIP_SVG.has(local)) return;
  // Before any of its elements is written: an animation may target the svg itself (its viewBox).
  if (svg && parentNs !== SVG_NS) collectSmil(walk.smil, el);
  const cs = view.win.getComputedStyle(el);
  // SVG resources (gradients, symbols) count even inside display:none, so only HTML subtrees go.
  if (!svg && cs.getPropertyValue("display") === "none") return;
  if (!svg && culled(walk, el, cs, view)) {
    walk.stats.culled++;
    return;
  }
  const hollow = !svg && hollowable(walk, el, cs, view, context);
  if (hollow) walk.stats.culled++;
  walk.stats.elements++;
  const z = zIndex(cs) ?? 0;
  if (view.top && z > 0) raise(walk, z);

  const override: Record<string, string> = {};
  const overflowX = cs.getPropertyValue("overflow-x");
  const overflowY = cs.getPropertyValue("overflow-y");
  // No scrollbars in a still frame; scroll offsets become a shift of the children.
  if (overflowX === "auto" || overflowX === "scroll") override["overflow-x"] = "hidden";
  if (overflowY === "auto" || overflowY === "scroll") override["overflow-y"] = "hidden";
  if (shift) override.translate = shiftedTranslate(cs.getPropertyValue("translate"), shift.x, shift.y);
  if (walk.onCanvas.has(el)) {
    override["background-color"] = "transparent";
    override["background-image"] = "none";
  }
  if (hollow) {
    // Without content a flex or grid item could shrink below the size it had.
    override["min-width"] = cs.getPropertyValue("width");
    override["min-height"] = cs.getPropertyValue("height");
  }
  const motion = svg && walk.smil.moving.has(el) ? motionMatrix(el) : null;
  if (motion) {
    for (const name of MOTION_RESET) override[name] = "none";
    override.transform = motion;
    override["transform-origin"] = "0px 0px";
    override["transform-box"] = "view-box";
  }
  const frame = local === "iframe" && !svg;
  // A video shows its controls while paused (playing, they hide once the pointer is away).
  const player = local === "video" && !svg && (el as HTMLVideoElement).controls && (el as HTMLVideoElement).paused;
  if (frame || player) {
    // The frame's document (the video's picture and controls) is drawn into a box that must size
    // and contain it like the element did.
    override["overflow-x"] = "hidden";
    override["overflow-y"] = "hidden";
    if (cs.getPropertyValue("display") === "inline") override.display = "inline-block";
    if (cs.getPropertyValue("position") === "static") override.position = "relative";
  }
  // An empty box away from the viewport shows nothing: only what sets its size and place counts.
  const props = hollow ? walk.baseline.layout : walk.baseline.props;
  const control = svg || hollow ? null : nativeControl(walk.baseline, el, cs);
  if (control?.scheme) override["color-scheme"] = control.scheme;
  const { text: styleBody, inherited } = styleText(walk.baseline, cs, parent, override, props, control?.ua);
  if (!hollow) useFonts(walk, cs);

  let tag = svg || ns !== XHTML_NS ? local : local === "html" || local === "body" ? "div" : local;
  if (!XML_NAME.test(tag)) tag = "span";
  const replaced = !svg && (local === "canvas" || local === "video" || local === "iframe");
  if (replaced && local !== "iframe") tag = "img";
  const canvas = local === "canvas" && !svg ? (el as HTMLCanvasElement) : null;
  const overlay = canvas ? overlayOf(walk, canvas, cs, view) : null;
  // Anything else drawn after the overlay candidates may cover them: they go into the image. A
  // canvas drawn over the image too keeps them, as it is drawn after them; an empty box away from
  // the viewport covers nothing.
  const covers = !hollow && !overlay && walk.overlays.length > 0;
  if (covers && paintsBox(cs, svg || replaced || VOID.has(local))) dropOverlays(walk);
  const xmlns = ns !== parentNs ? ` xmlns="${ns}"` : "";
  const pseudo = svg || replaced || VOID.has(local) ? null : pseudoRules(walk, el, view, inherited, hollow);
  if (pseudo && !hollow) dropOverlays(walk);
  const cls = pseudo ? ` class="${pseudo}"` : "";
  const style = styleBody ? ` style="${escapeAttr(embedCssUrls(walk, styleBody, "c"))}"` : "";
  let attrs = attributes(walk, el);
  if (!svg && local === "img") {
    const img = el as HTMLImageElement;
    const src = img.currentSrc || img.src;
    attrs += src && !src.startsWith("#") ? embedUrl(walk, src, "i", imageFallback(img)) : ` src="${BLANK_IMAGE}"`;
  } else if (canvas) {
    attrs = ` src="${canvasSource(walk, canvas, overlay)}"`;
  } else if (local === "video" && !svg) {
    attrs = videoSource(walk, el as HTMLVideoElement);
  }

  if (frame) {
    walk.out.push(`<div${xmlns}${style}>`);
    yield* emitFrame(walk, el as HTMLIFrameElement, cs);
    walk.out.push("</div>");
    return;
  }
  if (player) {
    walk.out.push(`<div${xmlns}${style}>${videoPlayer(walk, el as HTMLVideoElement, cs, attrs)}</div>`);
    return;
  }
  if (tag === "img") {
    walk.out.push(`<img${xmlns}${attrs}${cls}${style}/>`);
    return;
  }
  walk.out.push(`<${tag}${xmlns}${attrs}${cls}${style}>`);
  if (hollow) {
    walk.out.push(`</${tag}>`);
    return;
  }
  if (local === "textarea" && !svg) {
    walk.out.push(escapeText((el as HTMLTextAreaElement).value));
  } else {
    // The scrolling element reports the viewport's scroll, which emitDocument already applied.
    const scrolled = (el.scrollLeft !== 0 || el.scrollTop !== 0) && el !== el.ownerDocument.scrollingElement;
    const childShift = scrolled ? { x: -el.scrollLeft, y: -el.scrollTop } : null;
    const children = flatChildren(walk, el);
    const cover = coveringFrame(children, view);
    // Its own baseline positions nothing, and its children are laid out where one may go hollow.
    const inert =
      context &&
      HOLLOW_DISPLAYS.has(cs.getPropertyValue("display")) &&
      !cs.getPropertyValue("align-self").includes("baseline");
    const childContext = inert && hollowContext(cs);
    if (view.top) {
      const root = walk.path.length === 0;
      walk.path.push({ el, cs, context: root || stackingContext(cs), stacks: root || mayStack(cs), raised: 0 });
    }
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Node;
      if (child.nodeType === 1) {
        if (cover && i !== cover.index && underCover(child as Element, i, cover, view)) {
          walk.stats.culled++;
          continue;
        }
        yield* emitElement(walk, child as Element, view, inherited, ns, childShift, childContext);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        emitText(walk, child, childShift);
      }
    }
    if (view.top) walk.path.pop();
  }
  walk.out.push(`</${tag}>`);
}

/** The document of a same-origin frame drawn into its box, at its scroll position. */
function* emitFrame(walk: Walk, frame: HTMLIFrameElement, cs: CSSStyleDeclaration): Steps {
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    doc = null;
  }
  const win = doc?.defaultView as (Window & typeof globalThis) | null | undefined;
  if (!doc?.documentElement || !win) return;
  walk.watch?.observe(doc);
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  const at = {
    x: Number.parseFloat(cs.getPropertyValue("padding-left")) || 0,
    y: Number.parseFloat(cs.getPropertyValue("padding-top")) || 0,
  };
  yield* emitDocument(walk, docView(win, width, height, false), width, height, at);
}

function transparentColor(color: string): boolean {
  return color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

function hasBackground(cs: CSSStyleDeclaration): boolean {
  return (
    !transparentColor(cs.getPropertyValue("background-color")) || cs.getPropertyValue("background-image") !== "none"
  );
}

/**
 * The element whose background is the canvas's: the root when it has one, else the body of an
 * HTML root, else null. The page paints that background over the whole canvas, not in the box.
 */
function backgroundOwner(doc: Document, win: Window): Element | null {
  const root = doc.documentElement;
  if (hasBackground(win.getComputedStyle(root))) return root;
  const body = doc.body;
  if (!body || root.localName !== "html" || root.namespaceURI !== XHTML_NS) return null;
  return hasBackground(win.getComputedStyle(body)) ? body : null;
}

/** Canvas colour of a document: that of its background owner ({@link backgroundOwner}), else white. */
function canvasColor(win: Window, owner: Element | null): string {
  const color = owner ? win.getComputedStyle(owner).getPropertyValue("background-color") : "";
  return color && !transparentColor(color) ? color : "#fff";
}

/** Background longhands {@link canvasImages} sets itself. */
const CANVAS_OWN = new Set(["background-color", "background-origin", "background-clip", "background-attachment"]);

/**
 * The canvas's background images, or "": painted over the whole viewport, but sized and placed
 * against the root's box (the viewport when fixed), as the page paints them. Its padding box is that
 * area and transparent borders reach the viewport's edges, so tiles repeat out to them; it sits
 * under everything else of the document. The first layer's origin and attachment stand for all.
 */
function canvasImages(walk: Walk, view: DocView, owner: Element): string {
  const cs = view.win.getComputedStyle(owner);
  if (cs.getPropertyValue("background-image") === "none") return "";
  const first = (name: string) => (cs.getPropertyValue(name).split(",")[0] ?? "").trim();
  const v = view.viewport;
  let area: Box = v;
  if (first("background-attachment") !== "fixed") {
    const root = view.win.document.documentElement;
    const rs = view.win.getComputedStyle(root);
    const origin = first("background-origin");
    const inset = (side: (typeof SIDES)[number]) =>
      origin === "border-box"
        ? 0
        : px(rs, `border-${side}-width`) + (origin === "content-box" ? px(rs, `padding-${side}`) : 0);
    const r = root.getBoundingClientRect();
    area = {
      left: r.left + inset("left"),
      top: r.top + inset("top"),
      right: r.right - inset("right"),
      bottom: r.bottom - inset("bottom"),
    };
  }
  const edge = {
    top: Math.max(0, area.top - v.top),
    right: Math.max(0, v.right - area.right),
    bottom: Math.max(0, v.bottom - area.bottom),
    left: Math.max(0, area.left - v.left),
  };
  const decls = [
    "display:block;position:absolute;z-index:-2147483648;box-sizing:content-box",
    `left:${area.left - edge.left}px;top:${area.top - edge.top}px`,
    `width:${Math.max(0, area.right - area.left)}px;height:${Math.max(0, area.bottom - area.top)}px`,
    `border:solid transparent;border-width:${edge.top}px ${edge.right}px ${edge.bottom}px ${edge.left}px`,
  ];
  for (const name of walk.baseline.props) {
    if (name.startsWith("background-") && !CANVAS_OWN.has(name)) decls.push(`${name}:${cs.getPropertyValue(name)}`);
  }
  decls.push("background-origin:padding-box;background-clip:border-box;background-attachment:scroll");
  return `<div style="${escapeAttr(embedCssUrls(walk, decls.join(";"), "c"))}"></div>`;
}

/**
 * A document's viewport: a clipping box at `at` with the canvas background that holds the
 * document's fixed-position boxes (paint containment), and in it the initial containing block,
 * moved by the scroll offset, with the root inside it. Fixed boxes so stay in view when the
 * document is scrolled. The element the canvas took its background from is drawn without it.
 */
function* emitDocument(
  walk: Walk,
  view: DocView,
  width: number,
  height: number,
  at: { x: number; y: number } = { x: 0, y: 0 },
): Steps {
  const doc = view.win.document;
  const owner = backgroundOwner(doc, view.win);
  if (owner) walk.onCanvas.add(owner);
  const bg = canvasColor(view.win, owner);
  walk.out.push(
    `<div style="display:block;position:absolute;left:${at.x}px;top:${at.y}px;overflow:hidden;contain:paint;` +
      `width:${width}px;height:${height}px;background:${escapeAttr(bg)}">`,
    owner ? canvasImages(walk, view, owner) : "",
    `<div style="display:block;position:absolute;left:${-view.win.scrollX}px;top:${-view.win.scrollY}px;` +
      `width:${width}px;height:${height}px">`,
  );
  yield* emitElement(walk, doc.documentElement, view, null, XHTML_NS, null, true);
  walk.out.push("</div></div>");
}

/**
 * `@font-face` rules the frame uses, with their sources embedded, each face once: KaTeX fonts, for
 * one, are declared in the page, in the stage's sheet and through the FontFace API.
 */
async function fontCss(
  walk: Walk,
  source: SnapshotSource,
  docs: readonly Document[],
  cache: FontFaceCache,
): Promise<string> {
  const faces: FaceSource[] = [];
  const sheets = new Set<CSSStyleSheet>();
  const add = (list: Iterable<CSSStyleSheet>) => {
    for (const sheet of list) sheets.add(sheet);
  };
  for (const doc of docs) add([...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets]);
  for (const root of source.shadowRoots()) add([...Array.from(root.styleSheets), ...root.adoptedStyleSheets]);
  const win = source.document.defaultView;
  for (const sheet of sheets) {
    // Sheets that do not apply (disabled, or for other media) declare no fonts for this frame.
    const media = sheet.media.mediaText;
    if (sheet.disabled || (media && win && !win.matchMedia(media).matches)) continue;
    for (const rule of fontFaceRules(sheet)) faces.push(cache.rule(rule));
  }
  for (const face of source.faces()) faces.push(cache.face(face));
  const asked = new Map<string, Set<string>>();
  for (const use of walk.fonts) {
    const [face = "", families = ""] = use.split("\n");
    for (const family of familiesOf(families)) asked.set(family, (asked.get(family) ?? new Set()).add(face));
  }
  return cache.block(faces, { faces: asked, chars: () => frameChars(walk) });
}

/**
 * Code points beyond ASCII the frame may show: those of its markup (text, attribute values such as
 * input values, pseudo-element content), each with its upper and lower case for `text-transform`.
 */
function frameChars(walk: Walk): number[] {
  const seen = new Set<string>();
  for (const text of [...walk.out, ...walk.rules]) {
    if (NON_ASCII.test(text)) for (const [char] of text.matchAll(NON_ASCII_ALL)) seen.add(char);
  }
  const chars = new Set<number>();
  for (const char of seen) {
    for (const cased of [char, char.toUpperCase(), char.toLowerCase()]) {
      for (const unit of cased) chars.add(unit.codePointAt(0) as number);
    }
  }
  return Array.from(chars).sort((a, b) => a - b);
}

/**
 * Style sheet of the snapshot after its fonts (which open it, see {@link FrameSnapshot.parts}): the
 * reset every clone starts from, the resources used more than once and pseudo-elements. Ends the
 * `<style>` element.
 */
function sheetAfterFonts(rules: readonly string[], shared: readonly string[]): string {
  // Only the clones inside the foreignObject: resetting the wrapping `<svg>` and `<foreignObject>`
  // would turn their width and height (geometry properties) to `auto`, and Firefox then draws
  // nothing of the foreignObject.
  // The image is drawn in the host's forced colours (Windows high contrast) like a page; the clones
  // inherit this opt-out and keep the colours they were given, as in the CLI's browser. `:where`
  // leaves the reset at element specificity, so the shared-resource classes below still override it.
  const css = [
    "",
    "foreignObject{forced-color-adjust:none}",
    "foreignObject *:where(:not([data-sl-controls]):not([data-sl-controls] *)){all:unset}",
    "style{display:none!important}",
    ...shared,
    ...rules,
  ].join("\n");
  return `${css.replace(/]]>/g, "]]]]><![CDATA[>")}]]></style>`;
}

/**
 * Definitions of the resources used more than once: a class per resource for `<img>` clones
 * (`content` replaces the image) and custom properties on the snapshot's root (CSS `url()`s refer
 * to them). The class names the URL itself, not the custom property: Chromium makes a new image of
 * a `url()` substituted through `var()` for every element, and decodes each one again (a page
 * bitmap cropped into dozens of layers held the main thread for over 100 ms a frame).
 */
function sharedRules(walk: Walk, data: readonly string[]): string[] {
  const props: string[] = [];
  const classes: string[] = [];
  walk.urls.forEach((use, i) => {
    if (use.shared < 2) return;
    const url = `url(${cssString(data[i] ?? BLANK_IMAGE)})`;
    if (use.images > 0) classes.push(`.slr${i}{content:${url}}`);
    if (use.shared > use.images) props.push(`--slr${i}:${url}`);
  });
  return props.length > 0 ? [`foreignObject>div{${props.join(";")}}`, ...classes] : classes;
}

/** Keeps a CSS string inside the sheet's CDATA section (`\>` is `>` in CSS). */
function sheetSafe(css: string): string {
  return css.replace(/]]>/g, "]]\\>");
}

/** Markup for one token once every resource has its data URL (see {@link TOKEN}). */
function tokenText(walk: Walk, data: readonly string[], kind: string, index: number): string {
  if (kind === "k") return walk.canvases[index] ?? BLANK_IMAGE;
  const url = data[index] ?? BLANK_IMAGE;
  const shared = (walk.urls[index]?.shared ?? 0) > 1;
  switch (kind) {
    case "i":
      return shared ? ` class="slr${index}"` : ` src="${escapeAttr(url)}"`;
    case "c":
      return shared ? `var(--slr${index})` : escapeAttr(`url(${cssString(url)})`);
    case "s":
      return shared ? `var(--slr${index})` : sheetSafe(`url(${cssString(url)})`);
    default:
      return escapeAttr(url);
  }
}

/**
 * Watches what the walk reads for changes: the frame document, its watched shadow roots, the
 * frame documents the walk enters, and font loads (they move text without touching the DOM).
 */
function watchChanges(doc: Document, roots: readonly ShadowRoot[]): ChangeWatch {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const Observer = win?.MutationObserver ?? MutationObserver;
  let dirty = false;
  const mark = () => {
    dirty = true;
  };
  const observer = new Observer(mark);
  const fontSets: FontFaceSet[] = [];
  const observe = (node: Document | ShadowRoot) => {
    observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
    const fonts = node.nodeType === 9 ? (node as Document).fonts : undefined;
    if (fonts && !fontSets.includes(fonts)) {
      fonts.addEventListener("loadingdone", mark);
      fontSets.push(fonts);
    }
  };
  observe(doc);
  for (const root of roots) observe(root);
  return {
    observe,
    changed: () => dirty || observer.takeRecords().length > 0,
    stop() {
      observer.disconnect();
      for (const fonts of fontSets) fonts.removeEventListener("loadingdone", mark);
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The export was cancelled.", "AbortError");
}

/**
 * Writes the frame's markup in slices of about {@link SLICE_MS}, handing the main thread back in
 * between, so the exporting page stays responsive however large the frame is. Returns null when the
 * page changed while the walk paused (a script swapped an element, a font loaded): markup read
 * across a change could mix two states, so the caller walks again. After {@link MAX_RESTARTS} the
 * walk runs without pausing.
 */
async function walkFrame(
  source: SnapshotSource,
  baseline: StyleBaseline,
  resources: ResourceCache,
  restarts: number,
  signal: AbortSignal | undefined,
): Promise<Walk | null> {
  const win = source.document.defaultView as (Window & typeof globalThis) | null;
  if (!win) throw new Error("The frame document has no window");
  const roots = Array.from(source.shadowRoots());
  const byHost = new Map<Element, ShadowRoot>(roots.map((root) => [root.host, root]));
  const atomic = restarts >= MAX_RESTARTS;
  const watch = atomic ? null : watchChanges(source.document, roots);
  const walk: Walk = {
    baseline,
    smil: { attributes: new Map(), moving: new Set() },
    resources,
    shadowRootOf: (host) => byHost.get(host) ?? source.shadowRootOf(host),
    out: [],
    rules: [],
    fonts: new Set(),
    urls: [],
    urlIndex: new Map(),
    canvases: [],
    overlays: [],
    path: [],
    onCanvas: new Set(),
    watch,
    deadline: 0,
    stats: { elements: 0, culled: 0, restarts },
    nextClass: 0,
  };
  const { width, height } = source;
  walk.out.push(
    `<div xmlns="${XHTML_NS}" style="display:block;position:relative;width:${width}px;height:${height}px;overflow:hidden">`,
  );
  try {
    const steps = emitDocument(walk, docView(win, width, height, true), width, height);
    for (;;) {
      walk.deadline = atomic ? Number.POSITIVE_INFINITY : performance.now() + SLICE_MS;
      if (steps.next().done) return walk;
      await yieldTask();
      if (signal?.aborted) throw abortReason(signal);
      if (watch?.changed()) return null;
    }
  } finally {
    watch?.stop();
  }
}

/**
 * Serialises what the frame document shows into one SVG image: the flattened tree (shadow roots,
 * slots, same-origin frames) as XHTML in a `foreignObject`, every clone reset with `all: unset`
 * (a native form control with `all: revert`) and given back the computed values that differ, the
 * root's or body's background painted over the whole canvas, and every resource (images,
 * canvases, fonts) embedded as a data URL, since an SVG image loads nothing else. Resources used
 * more than once are embedded once for images and once for CSS.
 *
 * Only what can show is written: subtrees away from the viewport are left out (out of flow) or
 * written as empty boxes of their size (in flow), and boxes under a frame that covers the viewport
 * are left out. The canvases painted last (the cursor layer, and a WebGL model under it) are
 * returned as overlays rather than encoded into the image when nothing else paints after them. The
 * walk pauses every few milliseconds and starts over if the page changed meanwhile.
 *
 * Known limits: pseudo-elements other than `::before`/`::after` (custom `::marker`,
 * `::first-letter`) fall back to defaults; cross-origin images and videos without CORS are left
 * blank; a paused video's controls are a likeness of Chromium's;
 * WebGL canvases show what `toDataURL` (in the image) or `drawImage` (as overlays) returns at
 * capture time; `position: sticky` does not stick;
 * SMIL animations of keyword attributes (enumerations, `preserveAspectRatio`, `orient`) show the
 * base value; ink reaching more than {@link INK_MARGIN} px past the boxes of a subtree away from
 * the viewport (a huge shadow, a fixed-position pseudo-element) is not drawn.
 *
 * @throws The signal's reason when it aborts while the walk pauses.
 */
export async function snapshotFrame(
  source: SnapshotSource,
  baseline: StyleBaseline,
  resources: ResourceCache,
  faces: FontFaceCache,
  signal?: AbortSignal,
): Promise<FrameSnapshot> {
  let walk: Walk | null = null;
  for (let restarts = 0; !walk; restarts++) walk = await walkFrame(source, baseline, resources, restarts, signal);
  const doc = source.document;
  const docs = [doc];
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {
      // Cross-origin frames are drawn empty.
    }
  }
  const fonts = await fontCss(walk, source, docs, faces);
  for (const { index } of walk.overlays) walk.canvases[index] = BLANK_IMAGE;
  const data = await Promise.all(walk.urls.map(({ url, fallback }) => resources.resolve(url, fallback)));
  walk.out.push("</div>");
  const done = walk;
  const resolved = (text: string) =>
    text.replace(TOKEN, (_m, kind: string, index: string) => tokenText(done, data, kind, Number(index)));
  // The fonts sit between the root box and the rest of the sheet, out of reach of the token pass:
  // they are embedded already, and often megabytes long.
  const [root = "", ...body] = walk.out;
  const { width, height } = source;
  const head =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${root}<style><![CDATA[`;
  const tail = `${resolved(sheetAfterFonts(walk.rules, sharedRules(walk, data)) + body.join(""))}</foreignObject></svg>`;
  const overlays = walk.overlays.map(({ canvas, x, y, width: w, height: h, clip }) => ({
    canvas,
    x,
    y,
    width: w,
    height: h,
    clip,
  }));
  return { svg: head + fonts + tail, parts: [head, fonts, tail], stats: walk.stats, overlays };
}
