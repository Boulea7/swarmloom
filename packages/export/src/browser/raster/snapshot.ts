import { yieldTask } from "../schedule";
import type { FarCache } from "./far";
import { cssString, type FaceSource, type FontFaceCache, familiesOf, fontFaceRules, type WatchedFace } from "./fonts";
import { cssImagePending, markerImagesLoaded } from "./image-loads";
import { pickImageSets } from "./image-set";
import { BLANK_IMAGE, LONG_PIECE, type ResourceCache } from "./resources";
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
/** SMIL elements: they change what they animate without a mutation. */
const SMIL_ELEMENTS = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"]);
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
/** HTML elements without content, so without `::before`/`::after` boxes worth reading. */
const VOID = new Set(["img", "input", "br", "hr", "wbr", "area", "col", "select", "textarea"]);
const PSEUDOS = ["::before", "::after"] as const;
/**
 * Ink that may reach past the boxes a visibility check measures (shadows, outlines, blur, glyph
 * overhang), CSS px. Subtrees nearer to the viewport than this are always written.
 */
const INK_MARGIN = 256;
/** Displays whose box keeps its used size when written without its content. */
const HOLLOW_DISPLAYS = new Set(["block", "flow-root", "flex", "grid", "list-item"]);
/** Of those, the ones that hold their content's margins and floats in (block formatting contexts). */
const CONTAINED_DISPLAYS = new Set(["flow-root", "flex", "grid"]);
/** Of those, the ones a run of empty boxes written as one may hold (no list item: it steps a counter). */
const RUN_DISPLAYS = new Set(["block", "flow-root", "flex", "grid"]);
/** A counter declaration in a rule written for a pseudo-element (see {@link pseudoRules}). */
const COUNTER_DECLARATION = /[{;]counter-(?:increment|reset|set):/;
/** Block-level displays (the outer display of the others is inline, or they are internal parts). */
const BLOCK_LEVEL = new Set(["block", "list-item", "flow-root", "flex", "grid", "table", "-webkit-box"]);
/** HTML elements laid out as a whole whatever their display (replaced elements, form controls). */
const WHOLE = new Set([
  ...VOID,
  "button",
  "fieldset",
  "legend",
  "canvas",
  "video",
  "iframe",
  "object",
  "embed",
  "meter",
  "progress",
]);
/**
 * SVG elements whose content draws only where something refers to it by id, never where it sits.
 * Their content inherits from where they sit (not from what refers to them), except a `<symbol>`'s.
 */
const UNDRAWN_SVG = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "pattern",
  "filter",
  "marker",
]);
/**
 * Names a reference to an element written in the markup: `url(#id)` in a style or presentation
 * attribute, `href="#id"`. Anything else spelled that way (text) is a harmless extra match.
 */
const ID_REF = /#([\w.:-]+)/g;
/** Ids {@link ID_REF} finds whole; an element with any other id is written whether referred to or not. */
const PLAIN_ID = /^[\w.:-]+$/;
/** Inline-level boxes laid out as a whole (atomic inlines), by the layout of their content. */
const ATOMIC_INLINES: ReadonlyMap<string, string> = new Map([
  ["inline-block", "flow-root"],
  ["inline-flex", "flex"],
  ["inline-grid", "grid"],
]);
/** `vertical-align` values that place an inline-level box by its edges, whatever its baseline. */
const EDGE_ALIGNED = new Set(["top", "middle", "bottom", "text-top", "text-bottom"]);
/** Those a table cell takes; any other aligns it by its baseline. */
const CELL_ALIGNED = new Set(["top", "middle", "bottom"]);
/** Table parts that hold rows or cells: rows and groups of rows. */
const TABLE_ROWS = new Set(["table-row-group", "table-header-group", "table-footer-group", "table-row"]);
/** Text a table row lays out nothing for: CSS white space (a no-break space is not). */
const CSS_SPACE = /^[ \t\n\r\f]*$/;
/** HTML lists: the items inside one step its own `list-item` counter, seen in it and after it only. */
const LISTS = new Set(["ol", "ul", "menu"]);
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
  /**
   * Device px per CSS px the image is drawn at (default 1): a large photo is embedded only as large
   * as its box needs (see {@link ResourceCache.fitted}).
   */
  scale?: number;
  /**
   * The boxes earlier walks wrote away from the viewport, to write again without reading their
   * subtrees while nothing they depend on changed (see {@link FarCache}). Without it every walk
   * reads them all.
   */
  far?: FarCache<FarBox>;
}

/** What one snapshot found worth reporting. */
export interface SnapshotStats {
  elements: number;
  /**
   * Subtrees left out, or written as an empty box of the same size, because nothing in them can
   * show: transparent, away from the viewport, or under a frame that covers it.
   */
  culled: number;
  /** Of those, the ones written as an earlier walk wrote them, without reading them again. */
  reused: number;
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

/** A scroll container or document viewport the walk read, with its scroll offsets then. */
export interface ScrollMark {
  el: Element;
  left: number;
  top: number;
}

/**
 * A box the walk wrote empty, with the size its bounding box had then: the size written, which
 * places what follows it.
 */
export interface SizeMark {
  el: Element;
  width: number;
  height: number;
}

/** A canvas whose pixels went into the image, with the data URL read for it. */
export interface CanvasMark {
  canvas: HTMLCanvasElement;
  url: string;
}

/** One serialised frame. */
export interface FrameSnapshot {
  /** The image's markup (`parts` joined when read). */
  readonly svg: string;
  /**
   * `svg` in consecutive pieces, those of at least {@link LONG_PIECE} characters on their own: the
   * `@font-face` rules and the data URLs of images, canvases and video frames among them are the
   * same strings from frame to frame while they stay the same, so whoever encodes the image can
   * encode each once.
   */
  parts: readonly string[];
  stats: SnapshotStats;
  /** Canvases to draw over the image, in paint order (a WebGL model, then the cursor layer). */
  overlays: CanvasOverlay[];
  /**
   * The scroll offsets the image depends on: each scroll container written and each document
   * viewport (same-origin frames included), as the walk read them. Null when the image shows what
   * can change without a DOM mutation or a scroll: a video, a frame whose document cannot be read,
   * a shadow root the source does not list, SMIL animations, an image still loading (an `<img>`
   * written, or a CSS image that lays out a box the walk read, see {@link SIZING_IMAGES}).
   */
  settled: readonly ScrollMark[] | null;
  /** The boxes written empty, with their size: the image holds only while each keeps it. */
  sizes: readonly SizeMark[];
  /**
   * The canvases whose pixels are in the image rather than drawn over it (one painted under a live
   * page, for one): they change without a mutation, so the image holds only while each gives the
   * same data URL again.
   */
  pixels: readonly CanvasMark[];
  /** The documents of the same-origin frames drawn into the image (not those left out). */
  frames: readonly Document[];
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
  /**
   * Device px of the largest box an `<img>` showing it is drawn in, Infinity when one may draw it
   * larger than its box (see {@link imageBox}); a video poster counts as unbounded.
   */
  fit: { width: number; height: number };
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

/**
 * SVG elements with an id inside a box left out or written empty: something written may still
 * refer to them. After the walk, those the markup refers to go into `slot` of the walk's output,
 * in a hidden `<svg>` (see {@link emitKept}).
 */
interface KeptElements {
  slot: number;
  elements: readonly Element[];
  /** The box left out or written empty. */
  root: Element;
  view: DocView;
  /** Inherited values of the clone the slot sits in (null at the root). */
  parent: InheritedValues | null;
}

/** How a box is written empty (see {@link hollowable}). */
interface Hollow {
  /** Margins written instead of its own: those its content shared with it, CSS declarations. */
  margins: Record<string, string>;
  /** SVG elements in it with an id (see {@link KeptElements}). */
  kept: Element[];
  /** It holds its content's margins and floats in (a block formatting context, a cell, an item). */
  contained: boolean;
}

/**
 * How a box away from the viewport was written, to write it the same way again while nothing it
 * depends on changed (see {@link FarCache}): left out (`cut`), or as an empty box.
 */
export interface FarBox {
  cut: boolean;
  /** The SVG elements with an id kept from it (see {@link KeptElements}). */
  kept: readonly Element[];
  /** Its inherited values (an empty box hands them on to the SVG elements it keeps). */
  own: InheritedValues | null;
  /** An empty box's start tag up to where its class goes, the rest of it, and its end tag. */
  head: string;
  tail: string;
  close: string;
  /** Rules of its pseudo-elements without their class (`::before{...}`). */
  rules: readonly string[];
  z: number;
  /** It is a scroll container, at scroll offsets 0 (a {@link ScrollMark} of the walk). */
  scrolls: boolean;
  /** Reading it met a shadow root the source does not list (see {@link FrameSnapshot.settled}). */
  unlisted: boolean;
  /** What it adds to the block flow it sits in, when a run of such boxes may be written as one. */
  flow: FlowBox | null;
}

/** A box left out, as a {@link FarBox}. */
const CUT: FarBox = {
  cut: true,
  kept: [],
  own: null,
  head: "",
  tail: "",
  close: "",
  rules: [],
  z: 0,
  scrolls: false,
  unlisted: false,
  flow: null,
};

/**
 * What an empty box away from the viewport adds to the block flow around it, CSS px: siblings
 * written one after the other this way are written as one empty box (see {@link endRun}).
 */
interface FlowBox {
  /** Its top and bottom margins, as written (those its content shares with it included). */
  top: number;
  bottom: number;
  /** Its margin-box width: what it adds to the width of a box sized by its content. */
  width: number;
  /** It is a block formatting context, which a float beside it would move. */
  bfc: boolean;
}

/** Consecutive empty boxes written in one block flow, to be written as one (see {@link endRun}). */
interface FlowRun {
  first: Element;
  last: Element;
  boxes: FlowBox[];
  /** The markup written for them and the white space between them: `walk.out` from `start` up to `end`. */
  start: number;
  end: number;
  /** The rules written for their pseudo-elements: `walk.rules` from `rulesStart` up to `rulesEnd`. */
  rulesStart: number;
  rulesEnd: number;
}

/**
 * What reading the subtree of a box for the checks of a far box met (see {@link FarCache.record}),
 * and where the boxes it read lie: the union of their boxes.
 */
interface FarProbe extends Box {
  /**
   * A box laid out against one that may lie outside the subtree: absolutely positioned or fixed
   * with no containing block in it ({@link heldIn}), or sticky.
   */
  loose: boolean;
  /** SMIL animations, which change what they animate without a mutation. */
  smil: boolean;
  /** A shadow root the source does not list. */
  unlisted: boolean;
  /**
   * Where what overflows the box itself ends, right and down, as {@link offscreen} read it (its
   * scroll size takes in what overflows the boxes in it): Infinity along an axis it did not read.
   */
  edgeRight: number;
  edgeBottom: number;
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
  /** The shadow roots the source lists; a change in any other goes unseen (see {@link FrameSnapshot.settled}). */
  listed: ReadonlySet<ShadowRoot>;
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
  /** See {@link FrameSnapshot.pixels}. */
  pixels: CanvasMark[];
  /** Ancestors of the element being written, in the frame document only. */
  path: PathEntry[];
  /** Elements whose background the canvas paints instead (see {@link emitDocument}). */
  onCanvas: Set<Element>;
  /** SVG elements kept from boxes left out or written empty; null once they are being written. */
  kept: KeptElements[] | null;
  /** What {@link contentEdge} found for each box read, at its top and bottom edges. */
  edges: { start: Map<Element, Edge | null>; end: Map<Element, Edge | null> };
  watch: ChangeWatch | null;
  /** See {@link SnapshotSource.far}. */
  far: FarCache<FarBox> | null;
  /** What the far checks of the box being written met in its subtree, while they read it. */
  probe: FarProbe | null;
  /** The {@link FlowBox} of the element written last, if it was written as one ({@link joinRun}). */
  flow: { el: Element; box: FlowBox } | null;
  /** Multi-column boxes the element being written is in: their columns break the block flow. */
  columns: number;
  /** See {@link FrameSnapshot.settled}. */
  scrolls: ScrollMark[];
  /** See {@link FrameSnapshot.sizes}. */
  sizes: SizeMark[];
  /** See {@link FrameSnapshot.frames}. */
  frames: Document[];
  /** Something written can change without a DOM mutation or a scroll (see {@link FrameSnapshot.settled}). */
  unsettled: boolean;
  /** CSS images still loading that the walk found laying out a box it read ({@link noteImages}). */
  loading: number;
  /** By document, whether no list marker image its CSS gives still loads ({@link markersLoaded}). */
  markers: Map<Document, boolean>;
  /** `performance.now()` at which the walk pauses. */
  deadline: number;
  stats: SnapshotStats;
  nextClass: number;
  /** Random part of this walk's resource tokens (see {@link token}). */
  key: string;
}

/** Per-frame state of one document (the frame itself or the live page inside it). */
interface DocView {
  win: Window & typeof globalThis;
  viewport: Box;
  /** The viewport widened by {@link INK_MARGIN}: where a box may still show. */
  reach: Box;
  /** The frame document itself (not a page inside it). */
  top: boolean;
  /** Device px of the image per CSS px of this document, the transforms of the frames it is in included. */
  scale: number;
  /** Floats written so far in this document, and boxes left out that may hold some (see `FarKey.floats`). */
  floats: number;
  /**
   * Boxes the element being written is in that transform or zoom what is inside them, SVG elements
   * included (a view box scales a `foreignObject`): bounding boxes in them are not CSS px of layout.
   */
  transformed: number;
}

/** Steps of a walk: each `yield` hands the main thread back until the walk resumes. */
type Steps = Generator<void, void, void>;

function docView(win: Window & typeof globalThis, width: number, height: number, top: boolean, scale: number): DocView {
  return {
    win,
    viewport: { left: 0, top: 0, right: width, bottom: height },
    reach: { left: -INK_MARGIN, top: -INK_MARGIN, right: width + INK_MARGIN, bottom: height + INK_MARGIN },
    top,
    scale,
    floats: 0,
    transformed: 0,
  };
}

/**
 * Marks a resource in the markup until its data URL is known: the walk's key, a kind letter and an
 * index between private-use characters (they survive escaping). Kinds: "a" an attribute value, "i"
 * the source of an `<img>`, "c" a CSS `url()` in a style attribute, "s" one in a rule of the
 * snapshot's sheet, "k" the pixels of a canvas. `@font-face` rules are embedded on their own
 * ({@link FontFaceCache}). The page's text keeps its own private-use characters (icon fonts use
 * them), so the key is what tells a token from text spelling one: it is random for every walk.
 */
function token(walk: Walk, kind: "a" | "i" | "c" | "s" | "k", index: number): string {
  return `\uE000${walk.key}${kind}${index}\uE001`;
}

/** Matches the tokens of the walk with `key` (see {@link token}). */
function tokenPattern(key: string): RegExp {
  return new RegExp(`\uE000${key}([aciks])(\\d+)\uE001`, "g");
}

/** A random token key: 16 hex digits. */
function tokenKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A token for a resource URL, resolved after the walk (see {@link token} for the kinds). URLs used
 * more than once in shareable places are defined once in the sheet: a page bitmap cropped into
 * many layers would otherwise be inlined in every one of them. `box` is the size an `<img>` ("i")
 * draws it at (see {@link imageBox}), unbounded when left out.
 */
function embedUrl(
  walk: Walk,
  url: string,
  kind: "a" | "i" | "c" | "s",
  fallback?: () => string | null,
  box?: { width: number; height: number } | null,
): string {
  if (!url || url.startsWith("#")) return url;
  let index = walk.urlIndex.get(url);
  if (index === undefined) {
    index = walk.urls.length;
    walk.urlIndex.set(url, index);
    walk.urls.push({ url, fallback, shared: 0, images: 0, fit: { width: 0, height: 0 } });
  }
  const use = walk.urls[index] as ResourceUse;
  use.fallback ??= fallback;
  if (kind === "i" || kind === "c" || kind === "s") use.shared++;
  if (kind === "i") {
    use.images++;
    use.fit.width = Math.max(use.fit.width, box?.width ?? Number.POSITIVE_INFINITY);
    use.fit.height = Math.max(use.fit.height, box?.height ?? Number.POSITIVE_INFINITY);
  }
  return token(walk, kind, index);
}

/**
 * Tokens for the `url()`s of a CSS value written in a style attribute ("c") or a rule ("s"), each
 * `image-set()` first narrowed to the option the CLI shows.
 */
function embedCssUrls(walk: Walk, value: string, kind: "c" | "s"): string {
  const css = pickImageSets(value);
  if (!css.includes("url(")) return css;
  return css.replace(CSS_URL, (match, raw: string) => {
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
 * Displays whose scroll size takes in what overflows the boxes in flow in them (an inline box has
 * none; table parts are left to their cells).
 */
const SCROLL_BOXES = new Set([
  "block",
  "flow-root",
  "list-item",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
]);
/** Overflow values that clip a box's content to its padding box (`clip` may draw past it). */
const CLIPPING_OVERFLOW = new Set(["hidden", "auto", "scroll"]);

/** What of a box {@link offscreen} still checks: everything. */
const OPEN = 0;
/** Below a positioned box that clips its content away from view: only fixed boxes escape the clip. */
const CLIPPED = 1;
/** Below a transparent box, or a clipping one that holds fixed boxes: only SVG elements with an id count. */
const SEALED = 2;
type Reach = typeof OPEN | typeof CLIPPED | typeof SEALED;

/**
 * True when nothing of the flattened subtree of `el` can show: every box in it, widened by what
 * overflows it unclipped (text, pseudo-elements), lies outside `view.reach`. Below a positioned box
 * that clips its content and lies outside, only the position of each box is read: a fixed box
 * escapes that clip. Inside SVG elements drawn only where referred to ({@link UNDRAWN_SVG}), no box
 * is read. With `floats`, a floating box in it also counts as showing: it can move content that
 * follows `el`. With `transparent`, `el` paints nothing at all. Reads boxes and a few styles, a
 * small fraction of what writing the subtree costs.
 *
 * What overflows a box is read from its scroll size, which takes in what overflows the in-flow
 * boxes in it too (translated, transformed or not, as scrollbars show it): once a box above or
 * left of the area is found far that way, so is all the in-flow content in it, and only the boxes
 * out of flow in it are read again. Scroll sizes were most of the cost on long pages.
 *
 * Something visible may refer to an SVG element with an id wherever it sits (a gradient, clip path,
 * or a shape a `<use>` copies). Those are added to `kept`, to be written on their own when the
 * markup refers to them (see {@link emitKept}); without `kept`, any such element counts as showing.
 */
function offscreen(
  walk: Walk,
  el: Element,
  view: DocView,
  floats: boolean,
  transparent = false,
  kept: Element[] | null = null,
): boolean {
  const area = view.reach;
  const near = (left: number, top: number, right: number, bottom: number) =>
    right >= area.left && left <= area.right && bottom >= area.top && top <= area.bottom;
  const stack: Element[] = [el];
  const reaches: Reach[] = [transparent ? SEALED : OPEN];
  // Whether whatever overflows the box lies in a box found far already: a box in flow adds it to
  // the scroll size of the box around it, or is clipped by that box.
  const covers: boolean[] = [false];
  for (let next = stack.pop(); next; next = stack.pop()) {
    let reach = reaches.pop() as Reach;
    let covered = covers.pop() as boolean;
    if (next.namespaceURI === SVG_NS) {
      if (walk.probe && SMIL_ELEMENTS.has(next.localName)) walk.probe.smil = true;
      if (next.id) {
        if (!kept) return false;
        kept.push(next);
      }
      // Not drawn where it sits: its boxes, if any, show nothing there.
      if (UNDRAWN_SVG.has(next.localName)) reach = SEALED;
    }
    if (reach !== SEALED) {
      const cs = view.win.getComputedStyle(next);
      const position = cs.getPropertyValue("position");
      // A clip leaves out a fixed box only through a box that holds it.
      if (reach === CLIPPED) reach = position === "fixed" ? OPEN : holdsFixed(cs) ? SEALED : CLIPPED;
      if (reach === OPEN) {
        if (walk.probe && !walk.probe.loose && next !== el && position !== "static" && position !== "relative") {
          walk.probe.loose = !heldIn(next, position, el, view);
        }
        const r = next.getBoundingClientRect();
        if (near(r.left, r.top, r.right, r.bottom)) {
          // A box sitting at the origin may be no box at all (display: none or contents).
          const boxless =
            r.width === 0 && r.height === 0 && r.x === 0 && r.y === 0 && next.getClientRects().length === 0;
          if (!boxless) return false;
        } else if (walk.probe) {
          const probe = walk.probe;
          probe.left = Math.min(probe.left, r.left);
          probe.top = Math.min(probe.top, r.top);
          probe.right = Math.max(probe.right, r.right);
          probe.bottom = Math.max(probe.bottom, r.bottom);
        }
        if (floats && next !== el && cs.getPropertyValue("float") !== "none") return false;
        const box = next as HTMLElement;
        const overflowX = cs.getPropertyValue("overflow-x");
        const overflowY = cs.getPropertyValue("overflow-y");
        const openX = overflowX === "visible";
        const openY = overflowY === "visible";
        // A box out of flow adds to the scroll size of its containing block, which may lie outside;
        // a sticky box's offset is not in it.
        if (position !== "static" && position !== "relative") covered = false;
        // What overflows reaches out right and down (as read here): only a box above or left of the
        // area may reach into it, along the axis it falls short on.
        const spills = r.left <= area.right && r.top <= area.bottom;
        if (!covered && spills && (box.offsetWidth > 0 || box.offsetHeight > 0)) {
          const right =
            openX && r.right < area.left
              ? r.right + Math.max(0, box.scrollWidth - box.clientWidth) * (r.width / box.offsetWidth || 1)
              : r.right;
          const bottom =
            openY && r.bottom < area.top
              ? r.bottom + Math.max(0, box.scrollHeight - box.clientHeight) * (r.height / box.offsetHeight || 1)
              : r.bottom;
          if (near(r.left, r.top, right, bottom)) return false;
          // The far box being written (see FarProbe): its own overflow, where read above.
          if (walk.probe && next === el) {
            const inf = Number.POSITIVE_INFINITY;
            walk.probe.edgeRight = !openX || r.right < area.left ? right : inf;
            walk.probe.edgeBottom = !openY || r.bottom < area.top ? bottom : inf;
          }
          // Far along an axis its scroll size bounds, or that it clips: so is whatever overflows the
          // boxes in flow in it.
          const bounds = (open: boolean, overflow: string) => open || CLIPPING_OVERFLOW.has(overflow);
          covered =
            ((right < area.left && bounds(openX, overflowX)) || (bottom < area.top && bounds(openY, overflowY))) &&
            SCROLL_BOXES.has(cs.getPropertyValue("display"));
        }
        // Its content is clipped to it, all but the fixed boxes it does not hold.
        if (!openX && !openY && position !== "static") reach = holdsFixed(cs) ? SEALED : CLIPPED;
      }
    }
    // A frame's document stays inside the frame's box.
    if (next.localName === "iframe") continue;
    const children = flatChildren(walk, next);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as Node;
      if (child.nodeType !== 1) continue;
      stack.push(child as Element);
      reaches.push(reach);
      covers.push(covered);
    }
  }
  return true;
}

/**
 * Whether the containing block of `el`, positioned `position` (absolute, fixed or sticky), lies in
 * the subtree of `root`, an ancestor of it: then it moves with that subtree only. A sticky box
 * sticks to the nearest scroll container, which may lie outside.
 */
function heldIn(el: Element, position: string, root: Element, view: DocView): boolean {
  if (position === "sticky") return false;
  for (let up = flatParent(el); up?.nodeType === 1; up = flatParent(up)) {
    const cs = view.win.getComputedStyle(up as Element);
    if (holdsFixed(cs) || (position === "absolute" && cs.getPropertyValue("position") !== "static")) return true;
    if (up === root) return false;
  }
  return false;
}

function isList(el: Element): boolean {
  return el.namespaceURI === XHTML_NS && LISTS.has(el.localName);
}

/**
 * Whether a box with this style steps a counter. A list item steps `list-item` without saying so
 * in `counter-increment`, and numbers the items after it in the nearest list around it: `listed`
 * says that list is inside the subtree being checked, so its numbers do not reach out of it.
 */
function stepsCounter(cs: CSSStyleDeclaration, listed: boolean): boolean {
  if (!listed && cs.getPropertyValue("display").includes("list-item")) return true;
  return cs.getPropertyValue("counter-increment") !== "none" || cs.getPropertyValue("counter-set") !== "none";
}

/**
 * Whether an element of the flattened subtrees of `nodes`, or one of its `::before`/`::after`
 * boxes, increments or sets a counter, a list item outside any list among them included. Generated
 * content and list markers after them may show that counter, and the snapshot's clones count
 * again: leaving them out would change the numbers. Resets are not looked at: a reset reaches the
 * boxes after it under the same parent only, so one inside the subtrees is not seen after them.
 * One on `nodes` themselves is, and is for the caller to check ({@link resetsCounter}).
 *
 * The subtrees are left out or written empty when it finds none, as away from the viewport by
 * their boxes now: on the way it notes each CSS image still loading that lays out one of those
 * boxes ({@link noteImages}, {@link noteMarker}), which may grow it into view once loaded, without
 * an event.
 */
function stepsCounters(walk: Walk, nodes: readonly Node[], view: DocView): boolean {
  const stack: [Element, boolean][] = [];
  for (const node of nodes) if (node.nodeType === 1) stack.push([node as Element, false]);
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [el, inList] = next;
    const cs = view.win.getComputedStyle(el);
    const display = cs.getPropertyValue("display");
    if (display === "none") continue;
    if (stepsCounter(cs, inList)) return true;
    // SVG elements have no such boxes, and the snapshot writes none for void elements either.
    const html = el.namespaceURI !== SVG_NS;
    if (html) {
      const item = display.includes("list-item");
      noteImages(walk, el.ownerDocument, cs, item && !markersLoaded(walk, el));
      if (item) noteMarker(walk, el, view);
    }
    const pseudos = html && !VOID.has(el.localName) ? PSEUDOS : [];
    for (const pseudo of pseudos) {
      const ps = view.win.getComputedStyle(el, pseudo);
      const content = ps.getPropertyValue("content");
      if (!content || content === "none" || content === "normal") continue;
      if (stepsCounter(ps, inList)) return true;
      const item = ps.getPropertyValue("display").includes("list-item");
      noteImages(walk, el.ownerDocument, ps, item && !markersLoaded(walk, el), content);
    }
    // A frame's document counts on its own.
    if (el.localName === "iframe") continue;
    const childListed = inList || isList(el);
    for (const child of flatChildren(walk, el)) if (child.nodeType === 1) stack.push([child as Element, childListed]);
  }
  return false;
}

/**
 * Whether no list marker image the CSS of the document of `el` gives still loads, so the scan of a
 * far subtree need not read the `list-style-image` of its list items ({@link markerImagesLoaded}):
 * the value inherits, and each item of a list with an inlined bullet would serialise the whole data
 * URL again. Read once per walk and document, from the document and the shadow roots the source
 * lists; false for an element of a shadow root it does not list, whose sheets are not read.
 */
function markersLoaded(walk: Walk, el: Element): boolean {
  const root = el.getRootNode();
  if (root.nodeType !== 9 && !walk.listed.has(root as ShadowRoot)) return false;
  const doc = el.ownerDocument;
  let loaded = walk.markers.get(doc);
  if (loaded === undefined) {
    const roots = Array.from(walk.listed).filter((listed) => listed.ownerDocument === doc);
    loaded = markerImagesLoaded(doc, [doc, ...roots]);
    walk.markers.set(doc, loaded);
  }
  return loaded;
}

/**
 * Whether `el` itself resets a counter: the reset numbers the boxes after it as well as its own
 * content (its following siblings and theirs). A list resets `list-item`, which Chromium does not
 * report in `counter-reset`, and its items step it for the boxes after it too.
 */
function resetsCounter(el: Element, cs: CSSStyleDeclaration): boolean {
  return isList(el) || cs.getPropertyValue("counter-reset") !== "none";
}

/**
 * An absolutely positioned subtree that cannot show: fully transparent, or with nothing in it near
 * the viewport. Leaving it out cannot move anything else (it is out of flow), unless it counts:
 * it steps a counter, or resets one for the boxes after it. Returns null when it may show, else the
 * SVG elements with an id in it ({@link offscreen}). A CSS image still loading in it may grow it
 * into view: the walk notes it ({@link stepsCounters}).
 */
function culled(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView): Element[] | null {
  const position = cs.getPropertyValue("position");
  if (position !== "absolute" && position !== "fixed") return null;
  if (resetsCounter(el, cs)) return null;
  const kept: Element[] | null = walk.kept ? [] : null;
  if (!offscreen(walk, el, view, false, cs.getPropertyValue("opacity") === "0", kept)) return null;
  return stepsCounters(walk, [el], view) ? null : (kept ?? []);
}

/**
 * Where an element sits, as far as writing it as an empty box goes (see {@link hollowable}):
 * - LOOSE: a baseline may be read from it, or its parent lays it out in some other way;
 * - FLOW: in block flow, and no baseline is read from it;
 * - ITEMS: in a flex or grid container that aligns nothing by baseline, and no baseline is read
 *   from it: a flex or grid item holds its content's margins and floats in;
 * - TABLE: in a table's grid (a row group or row of a table, or a cell of such a row), and no
 *   baseline is read from the table;
 * - FAR_ROW: as TABLE, a cell of a row with nothing in it that can show ({@link faintRow}).
 */
const LOOSE = 0;
const FLOW = 1;
const TABLE = 2;
const FAR_ROW = 3;
const ITEMS = 4;
type Context = typeof LOOSE | typeof FLOW | typeof TABLE | typeof FAR_ROW | typeof ITEMS;

/**
 * Whether an inline-level box or a table cell is placed by its edges rather than by the baseline
 * of its content: aligned by its top, middle or bottom, or an inline block that clips its content
 * (its baseline is then its bottom margin edge).
 */
function edgeAligned(cs: CSSStyleDeclaration, display: string): boolean {
  const align = cs.getPropertyValue("vertical-align");
  if (display === "table-cell") return CELL_ALIGNED.has(align);
  if (EDGE_ALIGNED.has(align)) return true;
  if (display !== "inline-block") return false;
  const overflow = cs.getPropertyValue("overflow-x");
  const source = cs.getPropertyValue("baseline-source");
  return overflow !== "visible" && overflow !== "clip" && (source === "" || source === "auto");
}

/**
 * Whether `el` may be written as an empty box: its children are all away from the viewport, and
 * its place does not depend on them. Its used size is written anyway (computed width and height),
 * so what follows keeps its place, provided no baseline is read from it, its content steps no
 * counter, and it is:
 * - an in-flow block in a {@link FLOW} or {@link ITEMS} context with no floats inside, whose
 *   content's margins collapsing with its own are known ({@link sharedMargin}): none in a block
 *   formatting context, behind border or padding, or under a line;
 * - an inline block, flex or grid container placed in its line by its edges ({@link edgeAligned});
 * - a cell of one row and column in a {@link TABLE} context, placed by its edges: the grid keeps
 *   the widths written on every cell and the height written on this one.
 * Off-screen sections of a long live page then cost one element each, and siblings in one block
 * flow one in all ({@link endRun}); table rows cost one per cell.
 * Returns null when it may not, else the margins to write and the SVG elements it keeps.
 */
function hollowable(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView, context: Context): Hollow | null {
  const local = el.localName;
  if (VOID.has(local) || local === "canvas" || local === "video" || local === "iframe") return null;
  const display = cs.getPropertyValue("display");
  let contained = true;
  if (HOLLOW_DISPLAYS.has(display)) {
    if ((context !== FLOW && context !== ITEMS) || cs.getPropertyValue("float") !== "none") return null;
    if (cs.getPropertyValue("align-self").includes("baseline")) return null;
    contained = context === ITEMS || CONTAINED_DISPLAYS.has(display) || holdsContent(cs);
  } else if (display === "table-cell") {
    const cell = el as Partial<HTMLTableCellElement>;
    if (context !== TABLE && context !== FAR_ROW) return null;
    if ((cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1) return null;
    if (!edgeAligned(cs, display)) return null;
  } else if (!ATOMIC_INLINES.has(display) || local === "button" || !edgeAligned(cs, display)) {
    // A button takes its baseline from its content whatever its overflow.
    return null;
  }
  const position = cs.getPropertyValue("position");
  if (position !== "static" && position !== "relative") return null;
  if (!cs.getPropertyValue("width").endsWith("px") || !cs.getPropertyValue("height").endsWith("px")) return null;
  const r = el.getBoundingClientRect();
  if (r.height <= 0) return null;
  // Near the viewport: offscreen() below would say so first.
  const area = view.reach;
  if (r.right >= area.left && r.left <= area.right && r.bottom >= area.top && r.top <= area.bottom) return null;
  const margins: Record<string, string> = {};
  if (!contained) {
    // Collapsing margins run along the block axis; this reads them as vertical.
    if (cs.getPropertyValue("writing-mode") !== "horizontal-tb") return null;
    for (const start of [true, false]) {
      const side = start ? "top" : "bottom";
      const own = px(cs, `margin-${side}`);
      const shared = sharedMargin(own, edgeMargins(walk, el, cs, view, start));
      if (shared === null) return null;
      if (shared !== own) margins[`margin-${side}`] = `${shared}px`;
    }
  }
  const kept: Element[] | null = walk.kept ? [] : null;
  // The row of a FAR_ROW cell was found away from the viewport, all of it (SVG ids included).
  if (context !== FAR_ROW && !offscreen(walk, el, view, !contained, false, kept)) return null;
  // The box keeps its own counters and pseudo-elements, its content's would go: a list's items too,
  // which step its `list-item` counter for the boxes after it.
  if (stepsCounters(walk, flatChildren(walk, el), view)) return null;
  return { margins, kept: kept ?? [], contained };
}

/** Whether a block box holds its content's margins and floats in by its overflow or containment. */
function holdsContent(cs: CSSStyleDeclaration): boolean {
  const overflow = cs.getPropertyValue("overflow-x");
  return (
    (overflow !== "visible" && overflow !== "clip") ||
    /\b(?:layout|paint|strict|content)\b/.test(cs.getPropertyValue("contain"))
  );
}

/**
 * The margin a box written empty takes at one edge, or null when it cannot be known: its own
 * margin `own` and those of its content that may collapse with it (`edge`, see {@link edgeMargins})
 * collapse into one. When they all lie between 0 and `own`, that is `own` whether they collapse or
 * not; otherwise it is their largest (all positive) or smallest (all negative) when they surely
 * collapse, and unknown when they may not or their signs differ.
 */
function sharedMargin(own: number, edge: Edge | null): number | null {
  if (!edge) return null;
  const low = Math.min(own, edge.low);
  const high = Math.max(own, edge.high);
  const collapsed = low >= 0 ? high : high <= 0 ? low : null;
  if (collapsed === null) return null;
  return collapsed === own || edge.sure ? collapsed : null;
}

/** Margins of a box's content that may collapse with its own at one edge (see {@link edgeMargins}). */
interface Edge {
  /** The smallest and the largest of them, CSS px: `Infinity` and `-Infinity` when there are none. */
  low: number;
  high: number;
  /** They collapse with it for sure; false when they only may. */
  sure: boolean;
}

/** An {@link Edge} without margins. */
function noMargins(): Edge {
  return { low: Number.POSITIVE_INFINITY, high: Number.NEGATIVE_INFINITY, sure: true };
}

/** An edge of a box's content ends in a line (text, an inline box, a preserved space). */
const LINE = 1;
/** Nothing of a box's content lies at an edge (only boxes out of flow, collapsed white space). */
const NONE = 2;
/** What lies first or last in a box's content: a block-level child, or one of the above. */
type EdgeItem = typeof LINE | typeof NONE | { box: Element; cs: CSSStyleDeclaration; pseudo: boolean };

/**
 * The margins of the content of the block `el` that may collapse with its own margin at its top
 * (`start`) or bottom edge (CSS 2 §8.3.1): those of its first (last) in-flow block-level box, of
 * that box's first (last) one, and so on, up to a line, a border, padding, or a box that holds its
 * content's margins in. They surely collapse when every box on the way is a plain block (no block
 * formatting context) with no clearance and, at the bottom, an `auto` height (read through CSS
 * Typed OM, which Firefox lacks). Floats and positioned boxes are passed over. Null when the
 * content at that edge cannot be read: internal table or ruby boxes, generated block content, a
 * block with no height.
 */
function edgeMargins(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView, start: boolean): Edge | null {
  const content = contentEdge(walk, el, cs, view, start);
  // With no margins to collapse, whether they would does not matter.
  if (!content?.sure || content.low > content.high) return content;
  return holdsMargins(el, cs) === false && !cleared(cs, start) ? content : { ...content, sure: false };
}

/** Whether clearance may keep a box's top margin from collapsing with its parent's. */
function cleared(cs: CSSStyleDeclaration, start: boolean): boolean {
  return start && cs.getPropertyValue("clear") !== "none";
}

/**
 * The margins of the content of `el` at one edge as {@link edgeMargins} finds them, but for what
 * `el` itself adds: whether it lets them collapse with its own. Remembered for the walk: the boxes
 * of a chain share its end, so the wrappers of a framework's deep markup, each written with the
 * margin passed through it ({@link passedMargin}), read each box of the chain once rather than
 * once per wrapper above it.
 */
function contentEdge(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView, start: boolean): Edge | null {
  const known = start ? walk.edges.start : walk.edges.end;
  const side = start ? "top" : "bottom";
  // Boxes of the chain not read before, each with what it adds: its item's margin, and whether
  // that margin and the ones below surely collapse with its own as far as the box goes.
  const chain: { box: Element; margin: number; sure: boolean }[] = [];
  let box = el;
  let style = cs;
  let found: Edge | null | undefined;
  for (;;) {
    found = known.get(box);
    if (found !== undefined) break;
    if (px(style, `border-${side}-width`) > 0 || px(style, `padding-${side}`) > 0) {
      found = noMargins();
      break;
    }
    const step = noMargins();
    const item = edgeItem(walk, box, style, view, start, step);
    if (item === null || item === LINE || item === NONE) {
      found = item === null ? null : step;
      break;
    }
    if (!start && !autoHeight(box, style)) step.sure = false;
    // An inside marker may make a line before the content.
    const marker = style.getPropertyValue("display") === "list-item";
    if (start && marker && style.getPropertyValue("list-style-position") === "inside") step.sure = false;
    const margin = px(item.cs, `margin-${side}`);
    if (cleared(item.cs, start)) step.sure = false;
    const holds = holdsMargins(item.box, item.cs);
    if (holds === true) {
      found = { low: margin, high: margin, sure: step.sure };
      break;
    }
    // Generated block content, or a block that may collapse through and join its other margin.
    if (item.pseudo || holds === null || item.box.getBoundingClientRect().height <= 0) {
      found = null;
      break;
    }
    chain.push({ box, margin, sure: step.sure });
    box = item.box;
    style = item.cs;
  }
  known.set(box, found);
  for (let i = chain.length - 1; i >= 0; i--) {
    const { box: up, margin, sure } = chain[i] as (typeof chain)[number];
    if (found)
      found = { low: Math.min(margin, found.low), high: Math.max(margin, found.high), sure: sure && found.sure };
    known.set(up, found);
  }
  return found;
}

/**
 * Whether the block-level box `el` holds its content's margins in: true for a block formatting
 * context (a float or an absolutely positioned box among them, whose auto height takes in its last
 * content's margin) or a box laid out as a whole, false for a plain block, null when it may depend
 * on the engine (`align-content` on a block, a query container).
 */
function holdsMargins(el: Element, cs: CSSStyleDeclaration): boolean | null {
  const display = cs.getPropertyValue("display");
  if (display !== "block" && display !== "list-item") return true;
  if (cs.getPropertyValue("float") !== "none") return true;
  const position = cs.getPropertyValue("position");
  if (position === "absolute" || position === "fixed") return true;
  if (el.namespaceURI !== XHTML_NS || WHOLE.has(el.localName) || holdsContent(cs)) return true;
  if (el === el.ownerDocument.documentElement) return true;
  if (cs.getPropertyValue("column-count") !== "auto" || cs.getPropertyValue("column-width") !== "auto") return true;
  if (cs.getPropertyValue("writing-mode") !== "horizontal-tb") return true;
  const align = cs.getPropertyValue("align-content");
  if ((align !== "" && align !== "normal") || cs.getPropertyValue("container-type") !== "normal") return null;
  return false;
}

/**
 * The bottom margin to write on the block `el` written whole, or null to keep its own. Its clone is
 * given its used height, which keeps the margins of its content that collapsed through its bottom
 * edge on the page (an `auto` height) inside it: they go onto its own margin instead, when they
 * surely collapsed ({@link sharedMargin}) and `el` is no flex or grid item.
 */
function passedMargin(walk: Walk, el: Element, cs: CSSStyleDeclaration, view: DocView): string | null {
  const display = cs.getPropertyValue("display");
  if (display !== "block" && display !== "list-item") return null;
  if (px(cs, "border-bottom-width") > 0 || px(cs, "padding-bottom") > 0) return null;
  const own = px(cs, "margin-bottom");
  const shared = sharedMargin(own, edgeMargins(walk, el, cs, view, false));
  if (shared === null || shared === own || !inBlockFlow(el, view)) return null;
  return `${shared}px`;
}

/** Whether `el` is laid out in block flow: the box around it is no flex or grid container. */
function inBlockFlow(el: Element, view: DocView): boolean {
  for (let up = flatParent(el); up?.nodeType === 1; up = flatParent(up)) {
    const display = view.win.getComputedStyle(up as Element).getPropertyValue("display");
    if (display !== "contents") return !/flex|grid|box/.test(display);
  }
  return true;
}

/** Whether a block's computed height is `auto`, with no min or max height: its last margins can pass. */
function autoHeight(el: Element, cs: CSSStyleDeclaration): boolean {
  const min = cs.getPropertyValue("min-height");
  if ((min !== "0px" && min !== "auto") || cs.getPropertyValue("max-height") !== "none") return false;
  const map = (el as Partial<Element>).computedStyleMap;
  if (typeof map !== "function") return false;
  try {
    return String(map.call(el).get("height")) === "auto";
  } catch {
    return false;
  }
}

/**
 * The first (`start`) or last in-flow item of the content of `owner`, its `::before` and `::after`
 * boxes included, looking through `display: contents` and empty inline boxes: a block inside an
 * inline box (a custom element's) is laid out in the block around it, and shares margins with it
 * when nothing of the inline box makes a line before it. Clears `edge.sure` when an item may or may
 * not make a line; null when an item cannot be read.
 */
function edgeItem(
  walk: Walk,
  owner: Element,
  ownerStyle: CSSStyleDeclaration,
  view: DocView,
  start: boolean,
  edge: Edge,
): EdgeItem | null {
  // ::before, the children, ::after, from the edge in.
  const children = flatChildren(walk, owner);
  const count = children.length + 2;
  for (let k = 0; k < count; k++) {
    const i = start ? k : count - 1 - k;
    const found =
      i === 0 || i === count - 1
        ? pseudoItem(owner, view, i === 0 ? "::before" : "::after", edge)
        : childItem(walk, children[i - 1] as Node, ownerStyle, view, start, edge);
    if (found !== NONE) return found;
  }
  return NONE;
}

/** The `::before` or `::after` box of `owner` as an edge item (see {@link edgeItem}). */
function pseudoItem(owner: Element, view: DocView, pseudo: "::before" | "::after", edge: Edge): EdgeItem {
  if (owner.namespaceURI !== XHTML_NS || WHOLE.has(owner.localName)) return NONE;
  const ps = view.win.getComputedStyle(owner, pseudo);
  const content = ps.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") return NONE;
  const display = ps.getPropertyValue("display");
  const position = ps.getPropertyValue("position");
  // Boxes out of flow separate no margins.
  if (display === "none" || position === "absolute" || position === "fixed") return NONE;
  if (ps.getPropertyValue("float") !== "none") return NONE;
  if (display.startsWith("inline")) {
    if (display !== "inline" || content !== '""') return LINE;
    // An empty inline box makes a line only with horizontal margin, border or padding.
    edge.sure = false;
    return NONE;
  }
  return { box: owner, cs: ps, pseudo: true };
}

/** A child node of a box's content as an edge item (see {@link edgeItem}). */
function childItem(
  walk: Walk,
  node: Node,
  parentStyle: CSSStyleDeclaration,
  view: DocView,
  start: boolean,
  edge: Edge,
): EdgeItem | null {
  if (node.nodeType === 3 || node.nodeType === 4) return textItem(node.nodeValue ?? "", parentStyle);
  if (node.nodeType !== 1) return NONE;
  const el = node as Element;
  const cs = view.win.getComputedStyle(el);
  const display = cs.getPropertyValue("display");
  const position = cs.getPropertyValue("position");
  // Boxes out of flow separate no margins.
  if (display === "none" || position === "absolute" || position === "fixed") return NONE;
  if (cs.getPropertyValue("float") !== "none") return NONE;
  const html = el.namespaceURI === XHTML_NS;
  if (display === "contents") {
    // Replaced elements and controls without a box show nothing at all.
    return html && !WHOLE.has(el.localName) ? edgeItem(walk, el, cs, view, start, edge) : NONE;
  }
  if (display === "inline" && html && !WHOLE.has(el.localName)) {
    const edges = (sides: readonly string[]) =>
      sides.some((s) => px(cs, `margin-${s}`) !== 0 || px(cs, `padding-${s}`) > 0 || px(cs, `border-${s}-width`) > 0);
    if (edges(["left", "right"])) return LINE;
    // Whether those alone make a line differs between engines.
    if (edges(["top", "bottom"])) edge.sure = false;
    return edgeItem(walk, el, cs, view, start, edge);
  }
  if (display === "inline" && el.localName === "wbr") return NONE;
  // An atomic inline (inline block, replaced element) makes a line.
  if (display.startsWith("inline")) return LINE;
  // Internal table and ruby boxes, MathML: laid out in boxes of their own making.
  if (!BLOCK_LEVEL.has(display)) return null;
  return { box: el, cs, pseudo: false };
}

/** A text node as an edge item: a line unless it is white space its parent collapses away. */
function textItem(text: string, parentStyle: CSSStyleDeclaration): EdgeItem {
  if (!CSS_SPACE.test(text)) return LINE;
  let collapse = parentStyle.getPropertyValue("white-space-collapse");
  if (!collapse) {
    const ws = parentStyle.getPropertyValue("white-space");
    collapse = ws === "normal" || ws === "nowrap" ? "collapse" : ws === "pre-line" ? "preserve-breaks" : "preserve";
  }
  if (collapse === "collapse" || text === "") return NONE;
  if (collapse === "preserve-breaks") return /[\n\r\f]/.test(text) ? LINE : NONE;
  return LINE;
}

/** The context a box with this display gives its children by its own layout, its baseline aside. */
function layoutContext(display: string, cs: CSSStyleDeclaration): Context {
  if (display === "block" || display === "flow-root" || display === "list-item") return FLOW;
  if (display !== "flex" && display !== "grid") return LOOSE;
  return cs.getPropertyValue("align-items").includes("baseline") ? LOOSE : ITEMS;
}

/**
 * The context of the children of `el`, `context` its own (see {@link Context}). An HTML element
 * without a box (`display: contents`) or with an inline box hands its own on: its block children
 * are laid out in the box around it (framework wrappers, custom elements). No baseline is read from
 * a box out of flow, or from an inline box or table cell placed by its edges ({@link edgeAligned}).
 */
function childContext(el: Element, cs: CSSStyleDeclaration, context: Context): Context {
  const display = cs.getPropertyValue("display");
  if (display === "contents" || display === "inline") return el.namespaceURI === XHTML_NS ? context : LOOSE;
  if (TABLE_ROWS.has(display)) return context === TABLE ? TABLE : LOOSE;
  const inner = display === "table-cell" ? "flow-root" : ATOMIC_INLINES.get(display);
  if (inner !== undefined) return edgeAligned(cs, display) ? layoutContext(inner, cs) : LOOSE;
  const position = cs.getPropertyValue("position");
  const outOfFlow = position === "absolute" || position === "fixed" || cs.getPropertyValue("float") !== "none";
  const inFlowOf = context === FLOW || context === ITEMS;
  if ((!inFlowOf && !outOfFlow) || cs.getPropertyValue("align-self").includes("baseline")) return LOOSE;
  return display === "table" ? TABLE : layoutContext(display, cs);
}

/**
 * Whether the table row `el` has nothing in it that can show. It is written with what places it
 * only, and keeps its cells: they hold the table's column widths, row heights and collapsed borders
 * (and go empty on their own, see {@link hollowable}). Other children would be wrapped in a cell
 * that takes the row's fonts, so the row has only cells and white space.
 */
function faintRow(walk: Walk, el: Element, view: DocView): boolean {
  for (const child of flatChildren(walk, el)) {
    if (child.nodeType === 1) {
      const display = view.win.getComputedStyle(child as Element).getPropertyValue("display");
      if (display !== "table-cell" && display !== "none") return false;
    } else if ((child.nodeType === 3 || child.nodeType === 4) && !CSS_SPACE.test(child.nodeValue ?? "")) {
      return false;
    }
  }
  return offscreen(walk, el, view, false);
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
 * A same-origin frame among `children` whose opaque document box covers the whole viewport, or
 * null. Siblings that keep their subtree in a stacking context painted before it cannot show (the
 * render page's stage under the live page it went live to, when that page has a background).
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
  // Opaque: over a backdrop, or in an opaque colour of its own (rgb() rather than rgba()).
  const own = canvasBackground(win, backgroundOwner(doc, win), null);
  if (canvasBackdrop(doc, frame) === null && !own.startsWith("rgb(")) return null;
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
  for (const { canvas, index } of walk.overlays) walk.canvases[index] = canvasPixels(walk, canvas);
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
    // WebKit has no overflow-clip-margin and reads it as "", which is the 0px default.
    const margin = style.getPropertyValue("overflow-clip-margin");
    if (roundedCorners(style) || (margin !== "" && margin !== "0px")) return null;
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
  if (!overlay) return pixelsToken(walk, canvasPixels(walk, canvas));
  const index = walk.canvases.push(null) - 1;
  walk.overlays.push({ ...overlay, index });
  return token(walk, "k", index);
}

/**
 * A token for the data URL of drawn pixels (a canvas, a video frame): kept out of the markup until
 * the end, where it becomes a piece of its own (see {@link FrameSnapshot.parts}).
 */
function pixelsToken(walk: Walk, url: string): string {
  return token(walk, "k", walk.canvases.push(url) - 1);
}

/** `translate` value that adds an offset to the element's own `translate`. */
function shiftedTranslate(current: string, dx: number, dy: number): string {
  const parts = current === "none" ? [] : current.split(/\s+/);
  const x = Number.parseFloat(parts[0] ?? "0") || 0;
  const y = Number.parseFloat(parts[1] ?? "0") || 0;
  const z = parts[2] ? ` ${parts[2]}` : "";
  return `${x + dx}px ${y + dy}px${z}`;
}

/** The data URL of a canvas written into the image, noted in {@link Walk.pixels}. */
function canvasPixels(walk: Walk, canvas: HTMLCanvasElement): string {
  const url = canvasDataUrl(canvas);
  walk.pixels.push({ canvas, url });
  return url;
}

/** A canvas's pixels as a PNG data URL; a blank image when it is empty or cannot be read. */
export function canvasDataUrl(canvas: HTMLCanvasElement): string {
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
 * frame as a PNG, else nothing. A frame from another site cannot be read and is left blank. A
 * paused video's frame is encoded once while it stays where it is (see {@link stillFrame}).
 */
function videoSource(walk: Walk, video: HTMLVideoElement): string {
  if (showsPoster(video)) return embedUrl(walk, video.poster, "i");
  if (!hasFrame(video)) return ` src="${BLANK_IMAGE}"`;
  const key = stillFrame(video);
  const draw = () => videoFrameUrl(walk, video);
  return ` src="${pixelsToken(walk, key === null ? draw() : walk.resources.picture(video, key, draw))}"`;
}

/**
 * Names the frame a paused video shows: its source, position, ready state and size. Null while
 * the frame may change under the same name: a playing video's `currentTime` can trail its
 * picture, a seek has not shown its target yet, and a stream (`srcObject`) has no fixed frames.
 */
function stillFrame(video: HTMLVideoElement): string | null {
  if (!video.paused || video.seeking || video.srcObject) return null;
  const { currentSrc, currentTime, readyState, videoWidth, videoHeight } = video;
  return `${readyState} ${videoWidth}x${videoHeight} ${currentTime} ${currentSrc}`;
}

/** A video's current frame as a PNG data URL, or a blank image when another site's frame cannot be read. */
function videoFrameUrl(walk: Walk, video: HTMLVideoElement): string {
  const canvas = video.ownerDocument.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    const url = video.currentSrc;
    const name = url.length > 80 ? `${url.slice(0, 77)}...` : url;
    walk.resources.report(
      `The video ${name} could not be drawn in the frame (another site without CORS); it is left blank`,
    );
    return BLANK_IMAGE;
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

/**
 * The largest size, device px, at which the picture of `img` is drawn: its box as the page
 * transforms it, or its layout size where that is larger (a smaller picture could change how a
 * flex or grid item sizes). Null when the picture may be drawn larger than its box (`object-fit:
 * none`) or has to keep its own pixels (pixelated, or not turned as its EXIF orientation says).
 * Its bounding box overstates the size of a rotated box; a skewed or 3D-projected one is not
 * covered, and may show its picture at a lower resolution.
 */
function imageBox(
  img: HTMLImageElement,
  cs: CSSStyleDeclaration,
  view: DocView,
): { width: number; height: number } | null {
  if (cs.getPropertyValue("object-fit") === "none") return null;
  const rendering = cs.getPropertyValue("image-rendering");
  if (rendering !== "auto" && rendering !== "smooth" && rendering !== "high-quality") return null;
  if (cs.getPropertyValue("image-orientation") === "none") return null;
  const rect = img.getBoundingClientRect();
  return {
    width: Math.max(rect.width * view.scale, px(cs, "width")),
    height: Math.max(rect.height * view.scale, px(cs, "height")),
  };
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
  if (root) {
    if (!walk.listed.has(root)) {
      walk.unsettled = true;
      if (walk.probe) walk.probe.unlisted = true;
      walk.far?.watchRoot(root);
    }
    return Array.from(root.childNodes);
  }
  if (el.localName === "slot" && el.namespaceURI === XHTML_NS) {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return Array.from(el.childNodes);
}

/**
 * `::before` / `::after` of `el` as a rule on a class of the clone, or null when it has none. Those
 * of an empty box away from the viewport (`hollow`) keep only what sets their size and place, and
 * their counters. `inherited` gives what the clone of `el` passes on (read once, if needed). They
 * move with the scroll offset of `el` (`scroll`) like its children.
 */
function pseudoRules(
  walk: Walk,
  el: Element,
  view: DocView,
  inherited: () => InheritedValues,
  hollow: boolean,
  scroll: Scroll | null,
): string | null {
  const props = hollow ? walk.baseline.layout : walk.baseline.props;
  let cls: string | null = null;
  let from: InheritedValues | undefined;
  for (const pseudo of ["::before", "::after"] as const) {
    const ps = view.win.getComputedStyle(el, pseudo);
    const content = ps.getPropertyValue("content");
    if (!content || content === "none" || content === "normal") continue;
    cls ??= `sl${walk.nextClass++}`;
    from ??= inherited();
    const override: Record<string, string> = {};
    const item = () => /flex|grid|box/.test(view.win.getComputedStyle(el).getPropertyValue("display"));
    if (scroll) scrollWith(scroll, ps, item, override);
    const { text } = styleText(walk.baseline, ps, from, override, props);
    if (!hollow) useFonts(walk, ps);
    if (text.includes("url(") || content.includes("url(")) noteImages(walk, el.ownerDocument, ps, true, content);
    walk.rules.push(`.${cls}${pseudo}{${embedCssUrls(walk, text, "s")};content:${embedCssUrls(walk, content, "s")}}`);
  }
  return cls;
}

/** Records the fonts the text of a box may be drawn in. */
function useFonts(walk: Walk, cs: CSSStyleDeclaration): void {
  const face = `${cs.getPropertyValue("font-style")}|${cs.getPropertyValue("font-weight")}|${cs.getPropertyValue("font-stretch")}`;
  walk.fonts.add(`${face}\n${cs.getPropertyValue("font-family")}`);
}

/**
 * CSS properties whose image lays out the box it is on: as its content (an element's or a
 * pseudo-element's, a list item's `::marker` included: {@link noteMarker}), its list marker, or the
 * shape its float wraps lines around. Other CSS images only paint, and the image embeds each itself.
 */
const SIZING_IMAGES = ["content", "list-style-image", "shape-outside"] as const;

/**
 * Marks the snapshot unsettled while the page loads an image a box with style `cs` is laid out by
 * ({@link SIZING_IMAGES}), and counts it (`Walk.loading`): the page fires no event once a CSS image
 * has loaded, and the box then takes the image's size. That holds for a box written in full, at
 * the size it has now, as for one in a subtree left out or written empty, found away from the
 * viewport by its size now ({@link stepsCounters}); the far cache keeps no such subtree.
 *
 * @param marker Whether to check `list-style-image` too (it inherits: no use on a box that is no list item).
 * @param content The box's `content`, when the caller has read it.
 */
function noteImages(
  walk: Walk,
  doc: Document,
  cs: CSSStyleDeclaration,
  marker = true,
  content = cs.getPropertyValue("content"),
): void {
  for (const name of SIZING_IMAGES) {
    if (!marker && name === "list-style-image") continue;
    if (notePending(walk, doc, name === "content" ? content : cs.getPropertyValue(name))) return;
  }
}

/**
 * Notes the `::marker` image still loading of `el`, a list item, as {@link noteImages} does: the
 * marker's `content` lays out the item's marker box, and no property of the item names it.
 */
function noteMarker(walk: Walk, el: Element, view: DocView): void {
  notePending(walk, el.ownerDocument, view.win.getComputedStyle(el, "::marker").getPropertyValue("content"));
}

/** Marks the snapshot unsettled, and counts it, when `value` names an image `doc` still loads. */
function notePending(walk: Walk, doc: Document, value: string): boolean {
  if (!value.includes("url(") || !cssImagePending(doc, value)) return false;
  walk.unsettled = true;
  walk.loading++;
  return true;
}

/** Records the size of a box written empty (see {@link SizeMark}). */
function markSize(walk: Walk, el: Element): void {
  const r = el.getBoundingClientRect();
  walk.sizes.push({ el, width: r.width, height: r.height });
}

/**
 * The scroll offset of a scrolled box, negated (CSS px), as its children move by it: those in flow
 * do, and those out of flow it is the containing block of.
 */
interface Scroll {
  x: number;
  y: number;
  /** Absolutely positioned children lay out against the scrolled box (it is positioned, say). */
  absolute: boolean;
  /** Fixed children do too (it is transformed, say). */
  fixed: boolean;
  /** Its direction is right to left: the `right` of a relatively positioned child wins over its `left`. */
  rtl: boolean;
}

/** How the children of `el`, a scrolled box with the styles `cs`, move with its scroll offset. */
function scrollOf(el: Element, cs: CSSStyleDeclaration): Scroll {
  const fixed = holdsFixed(cs) || ["translate", "rotate", "scale"].some((name) => cs.getPropertyValue(name) !== "none");
  return {
    x: -el.scrollLeft,
    y: -el.scrollTop,
    absolute: fixed || cs.getPropertyValue("position") !== "static",
    fixed,
    rtl: cs.getPropertyValue("direction") === "rtl",
  };
}

/**
 * Moves a child of a scrolled box that has a box of its own (styles `cs`, an element or a
 * pseudo-element) by the scroll offset, into `override`, unless it is out of flow and lays out
 * against a box further out: the page does not scroll it. A box in flow is offset relatively, which
 * moves an inline box too (`translate` does not apply to those) and keeps a fixed box in it laid out
 * against the viewport; a box out of flow is translated. `item` tells whether it is a flex or grid
 * item.
 */
function scrollWith(
  scroll: Scroll,
  cs: CSSStyleDeclaration,
  item: () => boolean,
  override: Record<string, string>,
): void {
  const position = cs.getPropertyValue("position");
  if (position === "absolute" || position === "fixed") {
    if (position === "absolute" ? scroll.absolute : scroll.fixed) {
      override.translate = shiftedTranslate(cs.getPropertyValue("translate"), scroll.x, scroll.y);
    }
    return;
  }
  // The offsets a relatively positioned box is drawn at: its `top` and `left` as read, or its
  // `right` negated where the containing block runs right to left (`right` wins there when both are
  // set). A sticky box's offsets only say where it sticks, which the snapshot does not do.
  const relative = position === "relative";
  const left = relative ? (scroll.rtl ? -px(cs, "right") : px(cs, "left")) : 0;
  const top = relative ? px(cs, "top") : 0;
  override.position = "relative";
  override.left = `${left + scroll.x}px`;
  override.top = `${top + scroll.y}px`;
  override.right = "auto";
  override.bottom = "auto";
  // A static box takes its z-index only as a flex or grid item; once positioned it would anyway.
  if (position === "static" && zIndex(cs) !== null && !item()) override["z-index"] = "auto";
}

/** Whether a textarea's look is drawn from `name`: its border, background, shadow and their colour. */
function lookProperty(name: string): boolean {
  return name.startsWith("border-") || name.startsWith("background-") || name === "box-shadow" || name === "color";
}

/**
 * A scrolled textarea, whose clone would show its text from the top (a clone keeps no scroll
 * offset). It becomes a box in its place, written with its styles but its look (`override` as for
 * the textarea, `attrs` its attributes), that holds an empty textarea with its look over its border
 * box and its text, moved by the scroll offset, in a box clipped to its padding box.
 */
function scrolledTextarea(
  walk: Walk,
  area: HTMLTextAreaElement,
  cs: CSSStyleDeclaration,
  view: DocView,
  parent: InheritedValues | null,
  override: Readonly<Record<string, string>>,
  ua: ReadonlyMap<string, string> | undefined,
  attrs: string,
): string {
  const border = (side: (typeof SIDES)[number]) => px(cs, `border-${side}-width`);
  const box: Record<string, string> = {
    ...override,
    // The look is drawn over the border box, which a clip would cut away.
    "overflow-x": "visible",
    "overflow-y": "visible",
    "background-color": "transparent",
    "background-image": "none",
    "border-image-source": "none",
    "box-shadow": "none",
  };
  for (const side of SIDES) box[`border-${side}-color`] = "transparent";
  if (cs.getPropertyValue("display") === "inline") box.display = "inline-block";
  if (cs.getPropertyValue("position") === "static" && !override.position) {
    box.position = "relative";
    if (zIndex(cs) !== null && inBlockFlow(area, view)) box["z-index"] = "auto";
  }
  const look: Record<string, string> = {
    position: "absolute",
    left: `${-border("left")}px`,
    top: `${-border("top")}px`,
    width: `calc(100% + ${border("left") + border("right")}px)`,
    height: `calc(100% + ${border("top") + border("bottom")}px)`,
    "box-sizing": "border-box",
    "margin-top": "0px",
    "margin-right": "0px",
    "margin-bottom": "0px",
    "margin-left": "0px",
  };
  if (override["color-scheme"]) look["color-scheme"] = override["color-scheme"];
  const styled = (text: string) => (text ? ` style="${escapeAttr(embedCssUrls(walk, text, "c"))}"` : "");
  const boxStyle = styleText(walk.baseline, cs, parent, box).text;
  const lookStyle = styleText(walk.baseline, cs, parent, look, walk.baseline.props.filter(lookProperty), ua).text;
  const padding = SIDES.map((side) => cs.getPropertyValue(`padding-${side}`)).join(" ");
  return (
    `<div${attrs}${styled(boxStyle)}><textarea${styled(lookStyle)}></textarea>` +
    `<div style="display:block;position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;padding:${padding}">` +
    `<div style="display:block;position:relative;left:${-area.scrollLeft}px;top:${-area.scrollTop}px">` +
    `${escapeText(area.value)}</div></div></div>`
  );
}

/**
 * Emits a text node, shifted when its parent is a scrolled container. White space alone shows
 * nothing to shift, and wrapped it would become an item of a flex or grid container (with gaps
 * around it), where the page does not lay it out at all.
 */
function emitText(walk: Walk, node: Node, shift: Scroll | null): void {
  const text = escapeText(node.nodeValue ?? "");
  if (!text) return;
  if (walk.overlays.length > 0 && text.trim()) dropOverlays(walk);
  if (shift && !/^[ \t\n\r\f]*$/.test(text)) {
    walk.out.push(`<span style="position:relative;left:${shift.x}px;top:${shift.y}px">${text}</span>`);
  } else walk.out.push(text);
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
 * @param context Where its parent lays it out (see {@link Context}).
 */
function* emitElement(
  walk: Walk,
  el: Element,
  view: DocView,
  parent: InheritedValues | null,
  parentNs: string,
  scroll: Scroll | null,
  context: Context,
): Steps {
  if (performance.now() >= walk.deadline) yield;
  const ns = el.namespaceURI ?? XHTML_NS;
  const local = el.localName;
  const svg = ns === SVG_NS;
  if (ns === XHTML_NS && SKIP_HTML.has(local)) {
    // Not drawn, yet a floating one (an object, an embed) moves the content after it.
    if (walk.far && view.win.getComputedStyle(el).getPropertyValue("float") !== "none") view.floats++;
    return;
  }
  if (svg && SKIP_SVG.has(local)) return;
  // Before any of its elements is written: an animation may target the svg itself (its viewBox).
  if (svg && parentNs !== SVG_NS) collectSmil(walk.smil, el);
  // Not in a scrolled box (its scroll offset would be in the markup) nor in a far table row.
  const far = !svg && scroll === null && walk.kept && context !== FAR_ROW ? walk.far : null;
  const key = far ? { win: view.win, reach: view.reach, parent, parentNs, context, floats: view.floats } : null;
  const known = far && key ? far.reuse(el, key) : null;
  if (known) {
    writeFar(walk, el, view, parent, known);
    return;
  }
  const cs = view.win.getComputedStyle(el);
  const display = cs.getPropertyValue("display");
  // SVG resources (gradients, symbols) count even inside display:none, so only HTML subtrees go.
  if (!svg && display === "none") return;
  if (!svg && cs.getPropertyValue("float") !== "none") view.floats++;
  const probe: FarProbe | null = far ? farProbe() : null;
  walk.probe = probe;
  // A box with a CSS image still loading in it, which may grow it, is read again by the next walk.
  const loading = walk.loading;
  const cut = svg ? null : culled(walk, el, cs, view);
  if (cut) {
    walk.probe = null;
    walk.stats.culled++;
    keep(walk, cut, el, view, parent);
    if (far && key && probe && !probe.smil && walk.loading === loading) {
      const box: FarBox = { ...CUT, kept: cut, unlisted: probe.unlisted };
      const extent = farExtent(el, cs, probe);
      far.record(el, { ...key, extent, loose: probe.loose, open: false, scrolls: false }, box);
    }
    return;
  }
  const emptied = svg ? null : hollowable(walk, el, cs, view, context);
  walk.probe = null;
  const hollow = emptied !== null;
  if (hollow) walk.stats.culled++;
  // A table row away from the viewport keeps its cells; both are written with what places them only.
  const faint = !svg && !hollow && display === "table-row" && faintRow(walk, el, view);
  const bare = hollow || faint;
  const passed = svg || bare ? null : passedMargin(walk, el, cs, view);
  walk.stats.elements++;
  const z = zIndex(cs) ?? 0;
  if (view.top && z > 0) raise(walk, z);

  const override: Record<string, string> = {};
  const overflowX = cs.getPropertyValue("overflow-x");
  const overflowY = cs.getPropertyValue("overflow-y");
  const scrolls =
    (overflowX !== "visible" && overflowX !== "clip") || (overflowY !== "visible" && overflowY !== "clip");
  if (scrolls) walk.scrolls.push({ el, left: el.scrollLeft, top: el.scrollTop });
  // No scrollbars in a still frame; scroll offsets become a shift of the children.
  if (overflowX === "auto" || overflowX === "scroll") override["overflow-x"] = "hidden";
  if (overflowY === "auto" || overflowY === "scroll") override["overflow-y"] = "hidden";
  // An element without a box of its own hands the scroll offset on to its children.
  const boxless = !svg && display === "contents";
  if (scroll && !boxless) scrollWith(scroll, cs, () => !inBlockFlow(el, view), override);
  if (walk.onCanvas.has(el)) {
    override["background-color"] = "transparent";
    override["background-image"] = "none";
  }
  // Out of flex and grid items, whose flex basis would change meaning with the box sizing.
  const size = emptied && display !== "table-cell" && context !== ITEMS ? writtenSize(el, cs, view) : null;
  if (size) {
    override["box-sizing"] = "border-box";
    override.width = override["min-width"] = `${size.width}px`;
    override.height = override["min-height"] = `${size.height}px`;
  } else if (emptied) {
    // Without content a flex or grid item could shrink below the size it had.
    override["min-width"] = cs.getPropertyValue("width");
    override["min-height"] = cs.getPropertyValue("height");
  }
  if (emptied) Object.assign(override, emptied.margins);
  if (passed) override["margin-bottom"] = passed;
  // Nothing of it shows wherever it lands: a transform or offset that moved it away is not written.
  if (bare) override.visibility = cs.getPropertyValue("visibility") === "collapse" ? "collapse" : "hidden";
  // WebKit does not include an SVG transform attribute in the computed transform. Its origin still
  // has to be written: all:unset would otherwise put the clone's origin back at the box's centre.
  if (svg && el.hasAttribute("transform")) {
    override["transform-origin"] = cs.getPropertyValue("transform-origin") || "0px 0px";
  }
  const motion = svg && walk.smil.moving.has(el) ? motionMatrix(el) : null;
  if (motion) {
    for (const name of MOTION_RESET) override[name] = "none";
    override.transform = motion;
    override["transform-origin"] = "0px 0px";
    override["transform-box"] = "view-box";
  }
  const frame = local === "iframe" && !svg;
  // A video's picture and controls change without a mutation (a frame's document: see emitFrame).
  if (local === "video" && !svg) walk.unsettled = true;
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
  const tablePart = faint || (hollow && display === "table-cell");
  const props = tablePart ? walk.baseline.tableLayout : bare ? walk.baseline.layout : walk.baseline.props;
  const control = svg || bare ? null : nativeControl(walk.baseline, el, cs);
  if (control?.scheme) override["color-scheme"] = control.scheme;
  const { text: styleBody, inherited: own } = styleText(walk.baseline, cs, parent, override, props, control?.ua);
  // An image the box is laid out by is in its style where its value first differs from the
  // parent's (a box written empty has only layout values: those of its content were read in
  // hollowable, and one of its own sizes it, which is compared).
  if (!svg && styleBody.includes("url(")) noteImages(walk, el.ownerDocument, cs);
  // A list item's custom marker is not written (see snapshotFrame), yet an image as its content
  // lays the item out.
  if (!svg && display.includes("list-item")) noteMarker(walk, el, view);
  // A clone written with what places it only inherits everything else from its parent's clone.
  const handed = (): InheritedValues => (bare && parent ? new Map([...parent, ...own]) : own);
  if (!bare) useFonts(walk, cs);

  let tag = svg || ns !== XHTML_NS ? local : local === "html" || local === "body" ? "div" : local;
  if (!XML_NAME.test(tag)) tag = "span";
  const replaced = !svg && (local === "canvas" || local === "video" || local === "iframe");
  if (replaced && local !== "iframe") tag = "img";
  const canvas = local === "canvas" && !svg ? (el as HTMLCanvasElement) : null;
  const overlay = canvas ? overlayOf(walk, canvas, cs, view) : null;
  // Anything else drawn after the overlay candidates may cover them: they go into the image. A
  // canvas drawn over the image too keeps them, as it is drawn after them; an empty box away from
  // the viewport covers nothing.
  const covers = !bare && !overlay && walk.overlays.length > 0;
  if (covers && paintsBox(cs, svg || replaced || VOID.has(local))) dropOverlays(walk);
  const xmlns = ns !== parentNs ? ` xmlns="${ns}"` : "";
  // The text of a table row's or cell's pseudo-elements sizes the grid: it keeps its fonts.
  // The scrolling element reports the viewport's scroll, which emitDocument already applied.
  const scrolled = (el.scrollLeft !== 0 || el.scrollTop !== 0) && el !== el.ownerDocument.scrollingElement;
  const contentScroll = scrolled ? scrollOf(el, cs) : boxless ? scroll : null;
  const rulesFrom = walk.rules.length;
  const pseudo =
    svg || replaced || VOID.has(local) ? null : pseudoRules(walk, el, view, handed, bare && !tablePart, contentScroll);
  if (pseudo && !bare) dropOverlays(walk);
  const cls = pseudo ? ` class="${pseudo}"` : "";
  const style = styleBody ? ` style="${escapeAttr(embedCssUrls(walk, styleBody, "c"))}"` : "";
  let attrs = attributes(walk, el);
  if (!svg && local === "img") {
    const img = el as HTMLImageElement;
    // Its size may change once it has loaded.
    if (!img.complete) walk.unsettled = true;
    const src = img.currentSrc || img.src;
    attrs +=
      src && !src.startsWith("#")
        ? embedUrl(walk, src, "i", imageFallback(img), imageBox(img, cs, view))
        : ` src="${BLANK_IMAGE}"`;
  } else if (canvas) {
    attrs = ` src="${canvasSource(walk, canvas, overlay)}"`;
  } else if (local === "video" && !svg) {
    attrs = videoSource(walk, el as HTMLVideoElement);
  }

  if (frame) {
    walk.out.push(`<div${xmlns}${style}>`);
    yield* emitFrame(walk, el as HTMLIFrameElement, cs, view);
    walk.out.push("</div>");
    return;
  }
  if (player) {
    walk.out.push(`<div${xmlns}${style}>${videoPlayer(walk, el as HTMLVideoElement, cs, attrs)}</div>`);
    return;
  }
  const area = local === "textarea" && !svg && !bare ? (el as HTMLTextAreaElement) : null;
  if (area && (area.scrollLeft !== 0 || area.scrollTop !== 0)) {
    walk.out.push(scrolledTextarea(walk, area, cs, view, parent, override, control?.ua, `${xmlns}${attrs}`));
    return;
  }
  if (tag === "img") {
    walk.out.push(`<img${xmlns}${attrs}${cls}${style}/>`);
    return;
  }
  walk.out.push(`<${tag}${xmlns}${attrs}${cls}${style}>`);
  if (emptied) {
    // What it hands on is merged only for the SVG elements it keeps (most such boxes keep none).
    if (emptied.kept.length > 0) keep(walk, emptied.kept, el, view, handed());
    walk.out.push(`</${tag}>`);
    markSize(walk, el);
    const flow = size && flowBox(el, cs, context, emptied, size, walk.rules.slice(rulesFrom));
    if (far && key && probe && !probe.smil && walk.loading === loading && !scrolled && !walk.onCanvas.has(el)) {
      const box: FarBox = {
        cut: false,
        kept: emptied.kept,
        own,
        head: `<${tag}${xmlns}${attrs}`,
        tail: `${style}>`,
        close: `</${tag}>`,
        rules: pseudo ? walk.rules.slice(rulesFrom).map((rule) => rule.slice(pseudo.length + 1)) : [],
        z,
        scrolls,
        unlisted: probe.unlisted,
        flow: flow || null,
      };
      // A resource token is resolved for this walk only.
      const tokens = `\uE000${walk.key}`;
      if (![box.head, box.tail, ...box.rules].some((text) => text.includes(tokens))) {
        const { loose } = probe;
        far.record(el, { ...key, extent: farExtent(el, cs, probe), loose, open: !emptied.contained, scrolls }, box);
      }
    }
    walk.flow = flow ? { el, box: flow } : null;
    return;
  }
  if (local === "textarea" && !svg) {
    walk.out.push(escapeText((el as HTMLTextAreaElement).value));
  } else {
    const children = flatChildren(walk, el);
    const cover = coveringFrame(children, view);
    const inner = faint && context === TABLE ? FAR_ROW : childContext(el, cs, context);
    const inherited = handed();
    if (view.top) {
      const root = walk.path.length === 0;
      walk.path.push({ el, cs, context: root || stackingContext(cs), stacks: root || mayStack(cs), raised: 0 });
    }
    const columns =
      !svg && (cs.getPropertyValue("column-count") !== "auto" || cs.getPropertyValue("column-width") !== "auto");
    const transforms = svg || transformsContent(cs);
    if (columns) walk.columns++;
    if (transforms) view.transformed++;
    const runs = !columns && walk.columns === 0 && view.transformed === 0 && holdsRuns(el, cs, inner);
    const collapses = runs && collapsesSpace(cs);
    let run: FlowRun | null = null;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Node;
      if (child.nodeType === 1) {
        if (cover && i !== cover.index && underCover(child as Element, i, cover, view)) {
          walk.stats.culled++;
          // Unread, it may hold floats.
          view.floats++;
          run = endRun(walk, run);
          continue;
        }
        const at = walk.out.length;
        const rules = walk.rules.length;
        const floats = view.floats;
        yield* emitElement(walk, child as Element, view, inherited, ns, contentScroll, inner);
        if (runs) run = joinRun(walk, run, child as Element, view, at, rules, floats);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        // White space between blocks that collapses lays out nothing.
        if (!(run && collapses && CSS_SPACE.test(child.nodeValue ?? ""))) run = endRun(walk, run);
        emitText(walk, child, contentScroll);
      }
    }
    endRun(walk, run);
    if (columns) walk.columns--;
    if (transforms) view.transformed--;
    if (view.top) walk.path.pop();
  }
  walk.out.push(`</${tag}>`);
}

/**
 * The border-box size to write on a box written empty, CSS px: its bounding box, unless it or a
 * box it is in transforms or zooms it ({@link DocView.transformed}), then its computed size.
 * Computed lengths keep six significant digits, and Chromium truncates a length to its 1/64 px
 * layout unit: a box the page lays out 46.515625 px high computes as `46.5156px`, which lays out
 * as 46.5, so the boxes written that way above the viewport of a long page moved what shows by px.
 */
function writtenSize(el: Element, cs: CSSStyleDeclaration, view: DocView): { width: number; height: number } {
  if (view.transformed === 0 && !transformsContent(cs)) {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }
  const content = cs.getPropertyValue("box-sizing") !== "border-box";
  const edges = (a: "left" | "top", b: "right" | "bottom") =>
    content
      ? px(cs, `padding-${a}`) + px(cs, `padding-${b}`) + px(cs, `border-${a}-width`) + px(cs, `border-${b}-width`)
      : 0;
  return { width: px(cs, "width") + edges("left", "right"), height: px(cs, "height") + edges("top", "bottom") };
}

/**
 * What a box written empty adds to the block flow around it ({@link FlowBox}), or null when a run
 * of such boxes written as one would not lay out the same, or where its bounding box does not tell
 * where it lies in that flow: out of block flow (a flex or grid item, an inline block, a list item),
 * positioned against something or moved (a transform, a relative offset up or down), clearing
 * floats, stepping or resetting a counter (its pseudo-elements too), zoomed, in another writing
 * mode, with scroll bars or gutters the empty box would not keep, or keeping SVG elements or
 * resources.
 */
function flowBox(
  el: Element,
  cs: CSSStyleDeclaration,
  context: Context,
  emptied: Hollow,
  size: { width: number },
  rules: readonly string[],
): FlowBox | null {
  if (context !== FLOW || el.namespaceURI !== XHTML_NS || emptied.kept.length > 0) return null;
  if (!RUN_DISPLAYS.has(cs.getPropertyValue("display")) || transformsContent(cs)) return null;
  const position = cs.getPropertyValue("position");
  if (position === "relative" && (px(cs, "top") !== 0 || px(cs, "bottom") !== 0)) return null;
  if ((position !== "static" && position !== "relative") || cs.getPropertyValue("clear") !== "none") return null;
  if (cs.getPropertyValue("writing-mode") !== "horizontal-tb") return null;
  for (const name of ["counter-increment", "counter-reset", "counter-set"]) {
    if (cs.getPropertyValue(name) !== "none") return null;
  }
  for (const name of ["overflow-x", "overflow-y"]) {
    const overflow = cs.getPropertyValue(name);
    if (overflow === "auto" || overflow === "scroll") return null;
  }
  const gutter = cs.getPropertyValue("scrollbar-gutter");
  if (gutter && gutter !== "auto") return null;
  if (rules.some((rule) => COUNTER_DECLARATION.test(rule) || rule.includes("\uE000"))) return null;
  const margin = (side: (typeof SIDES)[number]) =>
    Number.parseFloat(emptied.margins[`margin-${side}`] ?? cs.getPropertyValue(`margin-${side}`)) || 0;
  return {
    top: margin("top"),
    bottom: margin("bottom"),
    width: margin("left") + size.width + margin("right"),
    bfc: holdsMargins(el, cs) !== false,
  };
}

/**
 * Whether the children of `el` lay out in block flow (`inner` is their {@link Context}), where a
 * run of them written empty may be written as one ({@link endRun}): in the horizontal writing mode,
 * in an HTML element that is not a fieldset (whose first legend sits in its border) nor a details
 * element. A box without a box of its own or an inline one hands on the block flow around it.
 */
function holdsRuns(el: Element, cs: CSSStyleDeclaration, inner: Context): boolean {
  if (el.namespaceURI !== XHTML_NS || el.localName === "fieldset" || el.localName === "details") return false;
  return inner === FLOW && cs.getPropertyValue("writing-mode") === "horizontal-tb";
}

/** Whether a box transforms or zooms itself and what is inside it, or moves it along a path. */
function transformsContent(cs: CSSStyleDeclaration): boolean {
  if (["transform", ...MOTION_RESET].some((name) => (cs.getPropertyValue(name) || "none") !== "none")) return true;
  const zoom = cs.getPropertyValue("zoom");
  return zoom !== "" && zoom !== "1";
}

/** Whether a box collapses the white space of its text: such text alone between blocks lays out nothing. */
function collapsesSpace(cs: CSSStyleDeclaration): boolean {
  const collapse = cs.getPropertyValue("white-space-collapse");
  if (collapse) return collapse === "collapse";
  const space = cs.getPropertyValue("white-space");
  return space === "normal" || space === "nowrap";
}

/**
 * Adds the element just written to the run of empty boxes it continues ({@link FlowRun}), starts
 * one, or ends the run: an element that wrote nothing in flow (not displayed, or left out out of
 * flow) keeps it going. A box that is a block formatting context joins only while no float came
 * before it in its document, as a float beside it would move it and not the box written instead.
 * `at`, `rules` and `floats` are the lengths of the markup and rules and the floats count before it.
 */
function joinRun(
  walk: Walk,
  run: FlowRun | null,
  el: Element,
  view: DocView,
  at: number,
  rules: number,
  floats: number,
): FlowRun | null {
  const flow = walk.flow?.el === el ? walk.flow.box : null;
  if (flow && (!flow.bfc || view.floats === 0)) {
    const end = walk.out.length;
    const rulesEnd = walk.rules.length;
    if (!run) return { first: el, last: el, boxes: [flow], start: at, end, rulesStart: rules, rulesEnd };
    run.last = el;
    run.boxes.push(flow);
    run.end = end;
    run.rulesEnd = rulesEnd;
    return run;
  }
  if (!flow && walk.out.length === at && walk.rules.length === rules && view.floats === floats) return run;
  return endRun(walk, run);
}

/**
 * Writes a run of two or more empty boxes in one block flow as one empty box, in place of their
 * markup and the rules of their pseudo-elements, so the length of a page adds little to the image.
 * Its height is the distance from the top of the first box to the bottom of the last one as laid
 * out (nothing they are in transforms them, see {@link DocView.transformed}, nor did anything move
 * them), which holds the margins between them as the page collapsed them; its own margins are the
 * first box's top margin and the last one's bottom margin, and its width their widest margin box
 * (what a box sized by its content reads).
 */
function endRun(walk: Walk, run: FlowRun | null): null {
  if (!run || run.boxes.length < 2) return null;
  const { boxes } = run;
  let width = 0;
  for (const box of boxes) width = Math.max(width, box.width);
  const height = run.last.getBoundingClientRect().bottom - run.first.getBoundingClientRect().top;
  if (!(height > 0)) return null;
  const first = boxes[0] as FlowBox;
  const last = boxes[boxes.length - 1] as FlowBox;
  walk.out[run.start] =
    `<div style="display:block;width:${width}px;height:${height}px;` +
    `margin-top:${first.top}px;margin-bottom:${last.bottom}px;visibility:hidden"></div>`;
  walk.out.fill("", run.start + 1, run.end);
  walk.rules.fill("", run.rulesStart, run.rulesEnd);
  return null;
}

function farProbe(): FarProbe {
  const inf = Number.POSITIVE_INFINITY;
  return {
    loose: false,
    smil: false,
    unlisted: false,
    left: inf,
    top: inf,
    right: -inf,
    bottom: -inf,
    edgeRight: inf,
    edgeBottom: inf,
  };
}

/**
 * Where what a far box may draw lies (see `FarKey.extent`): the boxes its checks read in it (the
 * probe), widened right and down by what overflows its own box, as {@link offscreen} read it;
 * unbounded along an axis it did not read, or when its scroll size cannot be read as such (a
 * transformed box, a table part). A box below or right of the viewport then stays away while it
 * stays there.
 */
function farExtent(el: Element, cs: CSSStyleDeclaration, probe: FarProbe): Box {
  const box = el as HTMLElement;
  const plain =
    el.namespaceURI === XHTML_NS &&
    SCROLL_BOXES.has(cs.getPropertyValue("display")) &&
    ["transform", "translate", "rotate", "scale"].every((name) => cs.getPropertyValue(name) === "none") &&
    box.offsetWidth > 0 &&
    box.offsetHeight > 0;
  const inf = Number.POSITIVE_INFINITY;
  return {
    left: probe.left,
    top: probe.top,
    right: plain ? Math.max(probe.right, probe.edgeRight) : inf,
    bottom: plain ? Math.max(probe.bottom, probe.edgeBottom) : inf,
  };
}

/**
 * Writes a box away from the viewport as an earlier walk wrote it (see {@link FarBox}), counting it
 * and noting what the walk would have noted reading it.
 */
function writeFar(walk: Walk, el: Element, view: DocView, parent: InheritedValues | null, box: FarBox): void {
  walk.stats.culled++;
  walk.stats.reused++;
  if (box.unlisted) walk.unsettled = true;
  if (box.cut) {
    keep(walk, box.kept, el, view, parent);
    return;
  }
  walk.stats.elements++;
  markSize(walk, el);
  if (view.top && box.z > 0) raise(walk, box.z);
  if (box.scrolls) walk.scrolls.push({ el, left: 0, top: 0 });
  let cls = "";
  if (box.rules.length > 0) {
    const name = `sl${walk.nextClass++}`;
    cls = ` class="${name}"`;
    for (const rule of box.rules) walk.rules.push(`.${name}${rule}`);
  }
  walk.out.push(`${box.head}${cls}${box.tail}`);
  if (box.kept.length > 0) {
    const handed = parent && box.own ? new Map([...parent, ...box.own]) : box.own;
    keep(walk, box.kept, el, view, handed);
  }
  walk.out.push(box.close);
  walk.flow = box.flow ? { el, box: box.flow } : null;
}

/**
 * Records the SVG elements with an id of `root`, a box left out or written empty, and keeps a slot
 * for them here in the output (see {@link emitKept}). `parent` is what the slot's parent clone
 * passes on.
 */
function keep(
  walk: Walk,
  elements: readonly Element[],
  root: Element,
  view: DocView,
  parent: InheritedValues | null,
): void {
  if (elements.length === 0 || !walk.kept) return;
  walk.kept.push({ slot: walk.out.push("") - 1, elements, root, view, parent });
}

/** The parent of a node in the flattened tree: its slot, else its parent, a shadow root's host. */
function flatParent(node: Node): Node | null {
  const slot = (node as Partial<Slottable>).assignedSlot;
  if (slot) return slot;
  const parent = node.parentNode;
  return parent?.nodeType === 11 ? ((parent as ShadowRoot).host ?? null) : parent;
}

/** Whether an element below `root` sits under a box with `display: none` (on the way up to `root`). */
function undisplayed(el: Element, root: Element, view: DocView): boolean {
  for (let node = flatParent(el); node && node !== root; node = flatParent(node)) {
    if (node.nodeType === 1 && view.win.getComputedStyle(node as Element).getPropertyValue("display") === "none") {
      return true;
    }
  }
  return false;
}

/** Ids the markup in `texts` may refer to, added to `into` (see {@link ID_REF}). */
function referredIds(into: Set<string>, texts: readonly string[]): void {
  for (const text of texts) {
    if (text.includes("#")) for (const [, id] of text.matchAll(ID_REF)) into.add(id as string);
  }
}

/**
 * Writes the SVG elements kept from boxes left out or written empty that the markup refers to,
 * and those the written ones refer to in turn, each in its slot: in a hidden zero-size `<svg>`
 * where they are drawn nowhere, or one with `display: none` for those that sat under such a box,
 * as the page has them. A gradient, clip path, mask, pattern, filter or marker inherits there
 * from the slot's parent clone, which the hidden `<svg>` hands on unchanged; anything else (a
 * symbol or shape a `<use>` copies) is written against its own parent's values, so that a copy
 * inherits from the `<use>` as on the page.
 */
function* emitKept(walk: Walk): Steps {
  const sites = walk.kept;
  // Boxes written now keep no SVG elements of their own (an HTML pattern or mask content).
  walk.kept = null;
  if (!sites || sites.length === 0) return;
  const refs = new Set<string>();
  referredIds(refs, walk.out);
  referredIds(refs, walk.rules);
  const out = walk.out;
  // Elements drawn nowhere paint over no overlay candidate.
  const overlays = walk.overlays;
  walk.overlays = [];
  const written = sites.map((site) => site.elements.map((): string | null => null));
  try {
    for (let found = true; found; ) {
      found = false;
      for (const [i, site] of sites.entries()) {
        for (const [j, el] of site.elements.entries()) {
          const done = written[i] as (string | null)[];
          if (done[j] !== null || (PLAIN_ID.test(el.id) && !refs.has(el.id))) continue;
          // An element kept in another written here is written with it.
          const outer = site.elements.findIndex((other, k) => k !== j && done[k] && other.contains(el));
          if (outer >= 0) {
            done[j] = "";
            continue;
          }
          walk.out = [];
          collectSmil(walk.smil, el);
          yield* emitElement(walk, el, site.view, keptParent(walk, el, site), SVG_NS, null, LOOSE);
          done[j] = walk.out.join("");
          referredIds(refs, [done[j] as string]);
          found = true;
        }
      }
    }
  } finally {
    walk.out = out;
    walk.overlays = overlays;
  }
  const box = "position:absolute;width:0;height:0;overflow:hidden";
  for (const [i, site] of sites.entries()) {
    const shown: string[] = [];
    const hidden: string[] = [];
    for (const [j, markup] of (written[i] as (string | null)[]).entries()) {
      if (!markup) continue;
      (undisplayed(site.elements[j] as Element, site.root, site.view) ? hidden : shown).push(markup);
    }
    const visibility = site.parent?.get("visibility") ?? "visible";
    const svg = (style: string, parts: string[]) =>
      parts.length > 0 ? `<svg xmlns="${SVG_NS}" style="${style}">${parts.join("")}</svg>` : "";
    out[site.slot] = svg(`${box};visibility:${visibility}`, shown) + svg("display:none", hidden);
  }
}

/** What a kept SVG element is written against (see {@link emitKept}). */
function keptParent(walk: Walk, el: Element, site: KeptElements): InheritedValues | null {
  if (UNDRAWN_SVG.has(el.localName) && el.localName !== "symbol") return site.parent;
  const up = flatParent(el);
  if (up?.nodeType !== 1) return site.parent;
  return styleText(walk.baseline, site.view.win.getComputedStyle(up as Element), null).inherited;
}

/** The document of a same-origin frame drawn into its box, at its scroll position. */
function* emitFrame(walk: Walk, frame: HTMLIFrameElement, cs: CSSStyleDeclaration, outer: DocView): Steps {
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    doc = null;
  }
  const win = doc?.defaultView as (Window & typeof globalThis) | null | undefined;
  if (!doc?.documentElement || !win) {
    // Drawn empty, but it may show a document later without a mutation here.
    walk.unsettled = true;
    return;
  }
  walk.watch?.observe(doc);
  walk.frames.push(doc);
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  const at = {
    x: Number.parseFloat(cs.getPropertyValue("padding-left")) || 0,
    y: Number.parseFloat(cs.getPropertyValue("padding-top")) || 0,
  };
  // How much the page's transforms scale the frame: its bounding box against its layout size.
  const rect = frame.getBoundingClientRect();
  const scaled = Math.max(
    frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1,
    frame.offsetHeight > 0 ? rect.height / frame.offsetHeight : 1,
  );
  yield* emitDocument(walk, docView(win, width, height, false, outer.scale * scaled), frame, width, height, at);
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

/** Chromium's `Canvas` colour in each scheme. */
const CANVAS = { light: "rgb(255, 255, 255)", dark: "rgb(18, 18, 18)" } as const;
/** A `<meta name="color-scheme">` content that parses: identifiers apart by white space. */
const META_SCHEME = /^\s*[a-z_-][\w-]*(?:\s+[a-z_-][\w-]*)*\s*$/i;

/**
 * The colour scheme `el` is drawn in, by Chromium's rule: `normal` takes the page's (its first
 * `<meta name="color-scheme">` that parses), and dark is used when only it is offered or the
 * window prefers it.
 */
function usedScheme(el: Element): keyof typeof CANVAS {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win) return "light";
  let keys = win.getComputedStyle(el).getPropertyValue("color-scheme").trim().toLowerCase().split(/\s+/);
  if (keys[0] === "normal" || keys[0] === "") {
    const meta = Array.from(doc.querySelectorAll('meta[name="color-scheme" i][content]')).find((m) =>
      META_SCHEME.test(m.getAttribute("content") ?? ""),
    );
    keys = (meta?.getAttribute("content") ?? "").trim().toLowerCase().split(/\s+/);
  }
  if (!keys.includes("dark")) return "light";
  return !keys.includes("light") || win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * What a document's canvas shows under its background, or null for what lies under it: the
 * `Canvas` colour of its root's scheme for the page itself, nothing for the document of `frame`
 * unless the root and the frame element use different schemes (CSS Color Adjust 1, as Chromium
 * draws it: a live page without a background shows the stage under it).
 */
function canvasBackdrop(doc: Document, frame: Element | null): string | null {
  const scheme = usedScheme(doc.documentElement);
  return frame && usedScheme(frame) === scheme ? null : CANVAS[scheme];
}

/**
 * The CSS background of a document's canvas: the colour of its background owner
 * ({@link backgroundOwner}) over the backdrop ({@link canvasBackdrop}).
 */
function canvasBackground(win: Window, owner: Element | null, backdrop: string | null): string {
  const color = owner ? win.getComputedStyle(owner).getPropertyValue("background-color") : "";
  if (!color || transparentColor(color)) return backdrop ?? "transparent";
  if (!backdrop || color.startsWith("rgb(")) return color;
  return `linear-gradient(${color},${color}),${backdrop}`;
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
 * `frame` is the element showing the document, null for the frame document itself.
 */
function* emitDocument(
  walk: Walk,
  view: DocView,
  frame: HTMLIFrameElement | null,
  width: number,
  height: number,
  at: { x: number; y: number } = { x: 0, y: 0 },
): Steps {
  const doc = view.win.document;
  const viewport = doc.scrollingElement ?? doc.documentElement;
  walk.scrolls.push({ el: viewport, left: viewport.scrollLeft, top: viewport.scrollTop });
  const owner = backgroundOwner(doc, view.win);
  if (owner) walk.onCanvas.add(owner);
  const bg = canvasBackground(view.win, owner, canvasBackdrop(doc, frame));
  walk.out.push(
    `<div style="display:block;position:absolute;left:${at.x}px;top:${at.y}px;overflow:hidden;contain:paint;` +
      `width:${width}px;height:${height}px;background:${escapeAttr(bg)}">`,
    owner ? canvasImages(walk, view, owner) : "",
    `<div style="display:block;position:absolute;left:${-view.win.scrollX}px;top:${-view.win.scrollY}px;` +
      `width:${width}px;height:${height}px">`,
  );
  yield* emitElement(walk, doc.documentElement, view, null, XHTML_NS, null, FLOW);
  walk.out.push("</div></div>");
}

/**
 * `@font-face` rules the frame uses, with their sources embedded, each face once: KaTeX fonts, for
 * one, are declared in the page, in the stage's sheet and through the FontFace API. Only those of
 * the documents drawn (the frame document and the same-origin frames the walk drew) and of their
 * shadow roots: nothing of a frame left out shows, its fonts included.
 */
async function fontCss(walk: Walk, source: SnapshotSource, cache: FontFaceCache): Promise<string> {
  const faces: FaceSource[] = [];
  const sheets = new Set<CSSStyleSheet>();
  const add = (list: Iterable<CSSStyleSheet>) => {
    for (const sheet of list) sheets.add(sheet);
  };
  const docs = [source.document, ...walk.frames];
  for (const doc of docs) add([...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets]);
  for (const root of source.shadowRoots()) {
    if (docs.includes(root.ownerDocument)) add([...Array.from(root.styleSheets), ...root.adoptedStyleSheets]);
  }
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
 * Pieces of the snapshot's markup (see {@link FrameSnapshot.parts}): consecutive short ones are
 * joined, one of at least {@link LONG_PIECE} characters stays a piece of its own.
 */
class Pieces {
  readonly #list: string[] = [];
  #short: string[] = [];

  add(text: string): void {
    if (text.length < LONG_PIECE) {
      this.#short.push(text);
      return;
    }
    this.#flush();
    this.#list.push(text);
  }

  /** Adds `text` with each token `tokens` matches replaced by what `resolve` writes for it. */
  addResolved(text: string, tokens: RegExp, resolve: (kind: string, index: number) => string): void {
    let at = 0;
    for (const match of text.matchAll(tokens)) {
      this.add(text.slice(at, match.index));
      this.add(resolve(match[1] as string, Number(match[2])));
      at = match.index + match[0].length;
    }
    this.add(text.slice(at));
  }

  done(): string[] {
    this.#flush();
    return this.#list;
  }

  #flush(): void {
    if (this.#short.length === 0) return;
    this.#list.push(this.#short.join(""));
    this.#short = [];
  }
}

/**
 * Start of the snapshot's style sheet after its fonts (which open it): the reset every clone starts
 * from. Only the clones inside the foreignObject: resetting the wrapping `<svg>` and
 * `<foreignObject>` would turn their width and height (geometry properties) to `auto`, and Firefox
 * then draws nothing of the foreignObject. The image is drawn in the host's forced colours
 * (Windows high contrast) like a page; the clones inherit this opt-out and keep the colours they
 * were given, as in the CLI's browser. `:where` leaves the reset at element specificity, so the
 * shared-resource classes after it still override it.
 */
const SHEET_RESET = [
  "",
  "foreignObject{forced-color-adjust:none}",
  "foreignObject *:where(:not([data-sl-controls]):not([data-sl-controls] *)){all:unset}",
  "style{display:none!important}",
].join("\n");

/** The rest of the sheet: the rules of pseudo-elements (with tokens). Ends the `<style>` element. */
function sheetRules(rules: readonly string[]): string {
  const css = rules.map((rule) => `\n${rule}`).join("");
  return `${css.replace(/]]>/g, "]]]]><![CDATA[>")}]]></style>`;
}

/** Keeps a CSS string inside the sheet's CDATA section (`\>` is `>` in CSS). */
function sheetSafe(css: string): string {
  return css.replace(/]]>/g, "]]\\>");
}

/** Writers of a data URL into the markup, for {@link ResourceCache.markup}. */
const srcAttribute = (url: string): string => ` src="${escapeAttr(url)}"`;
const styleUrl = (url: string): string => escapeAttr(`url(${cssString(url)})`);
const sheetUrl = (url: string): string => sheetSafe(`url(${cssString(url)})`);

/**
 * Adds the definitions of the resources used more than once to the sheet: a class per resource for
 * `<img>` clones (`content` replaces the image) and custom properties on the snapshot's root (CSS
 * `url()`s refer to them). The class names the URL itself, not the custom property: Chromium makes
 * a new image of a `url()` substituted through `var()` for every element, and decodes each one
 * again (a page bitmap cropped into dozens of layers held the main thread for over 100 ms a frame).
 * `pictures` are the data URLs for `<img>` clones, `data` those for CSS.
 */
function addSharedRules(pieces: Pieces, walk: Walk, data: readonly string[], pictures: readonly string[]): void {
  const shared = walk.urls.flatMap((use, i) => (use.shared > 1 ? [i] : []));
  const props = shared.filter((i) => (walk.urls[i] as ResourceUse).shared > (walk.urls[i] as ResourceUse).images);
  if (props.length > 0) {
    pieces.add("\nforeignObject>div{");
    props.forEach((i, n) => {
      pieces.add(`${n > 0 ? ";" : ""}--slr${i}:`);
      pieces.add(walk.resources.markup(data[i] ?? BLANK_IMAGE, sheetUrl));
    });
    pieces.add("}");
  }
  for (const i of shared) {
    if ((walk.urls[i] as ResourceUse).images === 0) continue;
    pieces.add(`\n.slr${i}{content:`);
    pieces.add(walk.resources.markup(pictures[i] ?? BLANK_IMAGE, sheetUrl));
    pieces.add("}");
  }
}

/**
 * Markup for one token once every resource has its data URL (see {@link token}): `pictures` for
 * `<img>` clones, `data` for the rest.
 */
function tokenText(
  walk: Walk,
  data: readonly string[],
  pictures: readonly string[],
  kind: string,
  index: number,
): string {
  if (kind === "k") return walk.canvases[index] ?? BLANK_IMAGE;
  const { resources } = walk;
  const shared = (walk.urls[index]?.shared ?? 0) > 1;
  switch (kind) {
    case "i":
      return shared ? ` class="slr${index}"` : resources.markup(pictures[index] ?? BLANK_IMAGE, srcAttribute);
    case "c":
      return shared ? `var(--slr${index})` : resources.markup(data[index] ?? BLANK_IMAGE, styleUrl);
    case "s":
      return shared ? `var(--slr${index})` : resources.markup(data[index] ?? BLANK_IMAGE, sheetUrl);
    default:
      return resources.markup(data[index] ?? BLANK_IMAGE, escapeAttr);
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
  const far = source.far ?? null;
  far?.begin(source);
  const walk: Walk = {
    baseline,
    smil: { attributes: new Map(), moving: new Set() },
    resources,
    shadowRootOf: (host) => byHost.get(host) ?? source.shadowRootOf(host),
    listed: new Set(roots),
    out: [],
    rules: [],
    fonts: new Set(),
    urls: [],
    urlIndex: new Map(),
    canvases: [],
    overlays: [],
    pixels: [],
    path: [],
    onCanvas: new Set(),
    kept: [],
    edges: { start: new Map(), end: new Map() },
    watch,
    far,
    probe: null,
    flow: null,
    columns: 0,
    scrolls: [],
    sizes: [],
    frames: [],
    unsettled: false,
    loading: 0,
    markers: new Map(),
    deadline: 0,
    stats: { elements: 0, culled: 0, reused: 0, restarts },
    nextClass: 0,
    key: tokenKey(),
  };
  const { width, height } = source;
  walk.out.push(
    `<div xmlns="${XHTML_NS}" style="display:block;position:relative;width:${width}px;height:${height}px;overflow:hidden">`,
  );
  try {
    const steps = (function* (): Steps {
      yield* emitDocument(walk, docView(win, width, height, true, source.scale ?? 1), null, width, height);
      yield* emitKept(walk);
    })();
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
 * more than once are embedded once for images and once for CSS. A large photo in an `<img>` is
 * embedded halved as often as its box allows ({@link ResourceCache.fitted}): the image decodes all
 * it embeds again on every frame whose markup changed.
 *
 * Only what can show is written: subtrees away from the viewport are left out (out of flow) or
 * written as empty boxes of their size (in flow), keeping the SVG elements in them that something
 * written refers to by id, and boxes under a frame that covers the viewport are left out. The
 * canvases painted last (the cursor layer, and a WebGL model under it) are returned as overlays
 * rather than encoded into the image when nothing else paints after them. The walk pauses every
 * few milliseconds and starts over if the page changed meanwhile.
 *
 * Known limits: pseudo-elements other than `::before`/`::after` (custom `::marker`,
 * `::first-letter`) fall back to defaults; cross-origin images and videos without CORS are left
 * blank; a paused video's controls are a likeness of Chromium's;
 * WebGL canvases show what `toDataURL` (in the image) or `drawImage` (as overlays) returns at
 * capture time; `position: sticky` does not stick; the children of a scrolled box are offset
 * relatively ({@link scrollWith}), so an absolutely positioned box nested in a static one of them
 * lays out against that child;
 * SMIL animations of keyword attributes (enumerations, `preserveAspectRatio`, `orient`) show the
 * base value; ink reaching more than {@link INK_MARGIN} px past the boxes of a subtree away from
 * the viewport (a huge shadow, a fixed-position pseudo-element) is not drawn; in Firefox, which
 * lacks CSS Typed OM, the margins a block's last content passes through its bottom edge stay inside
 * its clone (see {@link passedMargin}); a photo in a skewed or 3D-projected box may be embedded
 * smaller than it shows (see {@link imageBox}).
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
  source.far?.commit(walk.scrolls);
  const fonts = await fontCss(walk, source, faces);
  const smil = walk.smil.attributes.size > 0 || walk.smil.moving.size > 0;
  const settled = walk.unsettled || smil ? null : walk.scrolls;
  for (const { index } of walk.overlays) walk.canvases[index] = BLANK_IMAGE;
  const data = await Promise.all(walk.urls.map(({ url, fallback }) => resources.resolve(url, fallback)));
  // What `<img>` clones show: large photos only as large as their boxes need.
  const pictures = await Promise.all(
    walk.urls.map(({ images, fit }, i) => {
      const url = data[i] as string;
      const bounded = images > 0 && Number.isFinite(fit.width) && Number.isFinite(fit.height);
      return bounded ? resources.fitted(url, fit.width, fit.height) : url;
    }),
  );
  resources.nextFrame();
  walk.out.push("</div>");
  const done = walk;
  const [root = "", ...body] = walk.out;
  const { width, height } = source;
  const pieces = new Pieces();
  pieces.add(
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}">${root}<style><![CDATA[`,
  );
  // The fonts sit between the root box and the rest of the sheet, out of reach of the token pass:
  // they are embedded already, and often megabytes long.
  pieces.add(fonts);
  pieces.add(SHEET_RESET);
  addSharedRules(pieces, walk, data, pictures);
  pieces.addResolved(
    `${sheetRules(walk.rules)}${body.join("")}</foreignObject></svg>`,
    tokenPattern(walk.key),
    (kind, i) => tokenText(done, data, pictures, kind, i),
  );
  const parts = pieces.done();
  const overlays = walk.overlays.map(({ canvas, x, y, width: w, height: h, clip }) => ({
    canvas,
    x,
    y,
    width: w,
    height: h,
    clip,
  }));
  return {
    get svg() {
      return parts.join("");
    },
    parts,
    stats: walk.stats,
    overlays,
    settled,
    sizes: walk.sizes,
    pixels: walk.pixels,
    frames: walk.frames,
  };
}
