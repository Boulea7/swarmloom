import type { Layer, Rect } from "@swarmloom/core";
import { isElement, isText, viewOf } from "../dom/env";
import type { ResolvedOptions } from "../options";
import { contains, intersect, type Linear, outwardRect, roundRect } from "../util/geom";
import type { Slice } from "../util/slice";
import type { CounterIndex } from "./counters";
import type { BoxVisual } from "./styles";

/** A child in the flat (composed) tree together with the element its inherited styles come from. */
export interface FlatChild {
  node: Node;
  styleParent: Element;
}

/** Facts about an inline-level subtree, memoised per element. */
export interface InlineFacts {
  /** Every in-flow descendant is inline-level (out-of-flow descendants are ignored). */
  onlyInline: boolean;
  /** Contains visible, non-whitespace text (pseudo-element content included). */
  hasText: boolean;
}

/** Parsed ::before / ::after content. */
export interface PseudoInfo {
  cs: CSSStyleDeclaration;
  text: string;
  image: string | null;
  display: string;
  position: string;
}

/** Everything the capture reads about one element. Each value is read at most once per snapshot. */
export interface ElInfo {
  readonly el: Element;
  readonly cs: CSSStyleDeclaration;
  readonly display: string;
  readonly position: string;
  readonly visibility: string;
  readonly opacity: number;
  readonly float: string;
  rect: DOMRect | undefined;
  children: FlatChild[] | undefined;
  facts: InlineFacts | undefined;
  textProps: Record<string, string> | undefined;
  visual: BoxVisual | undefined;
  /** The element is the containing block of fixed descendants (memoised). */
  fixedCb: boolean | undefined;
  before: PseudoInfo | null | undefined;
  after: PseudoInfo | null | undefined;
}

/** Walk context: how the current subtree maps to the world and what clips it. */
export interface Ctx {
  /** Viewport -> world offset. */
  dx: number;
  dy: number;
  /** Clip for in-flow content, for absolutely positioned content, for fixed content (world coordinates). */
  clip: Rect | null;
  absClip: Rect | null;
  fixedClip: Rect | null;
  /** Accumulated ancestor opacity. */
  opacity: number;
  /** Accumulated linear part of ancestor transforms. */
  linear: Linear | null;
  /** Paint-order key prefix for in-flow content and for the enclosing stacking context. */
  paintKey: readonly number[];
  stackKey: readonly number[];
  /** Nearest ancestor box layer: built before this subtree. */
  parentId: string | undefined;
  parentIsFlexOrGrid: boolean;
  /** True while outside the unrolled main scroller of an app shell. */
  outsideShell: boolean;
  inFixed: boolean;
  /** An ancestor is the containing block of fixed descendants (transform, filter, contain). */
  fixedContainer: boolean;
  frameDepth: number;
  /** Offset of the current (i)frame viewport inside the top-level viewport. */
  frameX: number;
  frameY: number;
}

/** Light record of an element subtree that emitted layers [start, end): input of duplicate detection. */
export interface NodeRec {
  tag: string;
  classes: string;
  box: Rect;
  start: number;
  end: number;
  children: NodeRec[];
}

/** An app-shell main scroller whose content is unrolled into the world. */
export interface Shell {
  el: Element;
  /** Padding-box top/bottom in viewport coordinates. */
  vTop: number;
  vBottom: number;
  /** Extra world height gained by unrolling: scrollHeight - clientHeight. */
  delta: number;
}

export interface FloatRec {
  box: Rect;
  side: "left" | "right";
}

/** Media that may be replaced by a crop of the screenshot once it is decoded. */
export interface PendingShot {
  id: string;
  /** Viewport rect at capture time. */
  rect: Rect;
  fixed: boolean;
}

export interface Capture {
  readonly doc: Document;
  readonly root: Element;
  readonly mode: "document" | "element";
  readonly opts: ResolvedOptions;
  readonly layers: Layer[];
  readonly keys: (readonly number[])[];
  readonly infos: Map<Element, ElInfo>;
  /** CSS counter values per document or shadow root, built on first use. */
  readonly counters: Map<Node, CounterIndex>;
  readonly nodes: NodeRec[];
  readonly rootNode: NodeRec;
  readonly floats: FloatRec[];
  readonly fixedIds: Set<string>;
  readonly baselines: Map<string, number>;
  readonly families: Set<string>;
  readonly shadowRoots: Set<ShadowRoot>;
  readonly pendingShots: PendingShot[];
  readonly bgSources: Set<Element>;
  readonly range: Range;
  shell: Shell | null;
  worldW: number;
  maxBottom: number;
  seq: number;
  treeIndex: number;
  /** Elements walked in full, and the budget for them. */
  visited: number;
  readonly maxElements: number;
  /** Elements only skimmed for fixed and out-of-flow content (see visitDropped), and their budget. */
  skimmed: number;
  readonly maxSkimmed: number;
  elementCapHit: boolean;
  /**
   * Layers dropped below maxHeight, and layers refused because the capture already holds far more
   * than maxLayers. Skimmed subtrees count one per element: an estimate, since they are not read.
   */
  droppedHeight: number;
  overflow: number;
  readonly hardLimit: number;
  /** Deadline of the current walk slice (set by the driver in snapshot.ts). */
  readonly slice: Slice;
  svgSeq: number;
  fontRatios: Map<string, number>;
  measure: CanvasRenderingContext2D | null | undefined;
}

export function createCapture(
  doc: Document,
  root: Element,
  mode: "document" | "element",
  opts: ResolvedOptions,
): Capture {
  const rootNode: NodeRec = {
    tag: root.localName,
    classes: "",
    box: { x: 0, y: 0, w: 0, h: 0 },
    start: 0,
    end: 0,
    children: [],
  };
  const maxElements = Math.max(20000, opts.maxLayers * 8);
  return {
    doc,
    root,
    mode,
    opts,
    layers: [],
    keys: [],
    infos: new Map(),
    counters: new Map(),
    nodes: [rootNode],
    rootNode,
    floats: [],
    fixedIds: new Set(),
    baselines: new Map(),
    families: new Set(),
    shadowRoots: new Set(),
    pendingShots: [],
    bgSources: new Set(),
    range: doc.createRange(),
    shell: null,
    worldW: 0,
    maxBottom: 0,
    seq: 0,
    treeIndex: 0,
    visited: 0,
    maxElements,
    skimmed: 0,
    // Skimming reads a few style facts per element, a fraction of the cost of a full visit.
    maxSkimmed: maxElements * 4,
    elementCapHit: false,
    droppedHeight: 0,
    overflow: 0,
    hardLimit: opts.maxLayers * 2 + 256,
    slice: { deadline: Number.POSITIVE_INFINITY },
    svgSeq: 0,
    fontRatios: new Map(),
    measure: undefined,
  };
}

/** Computed-style facts of an element (one getComputedStyle per element and snapshot). */
export function infoOf(cap: Capture, el: Element): ElInfo {
  let info = cap.infos.get(el);
  if (info) return info;
  const cs = viewOf(el).getComputedStyle(el);
  const opacity = Number.parseFloat(cs.opacity);
  info = {
    el,
    cs,
    display: cs.display,
    position: cs.position,
    visibility: cs.visibility,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    float: cs.cssFloat || cs.getPropertyValue("float"),
    rect: undefined,
    children: undefined,
    facts: undefined,
    textProps: undefined,
    visual: undefined,
    fixedCb: undefined,
    before: undefined,
    after: undefined,
  };
  cap.infos.set(el, info);
  return info;
}

export function rectOf(info: ElInfo): DOMRect {
  if (!info.rect) info.rect = info.el.getBoundingClientRect();
  return info.rect;
}

/**
 * Children in the flat tree: open shadow roots replace light children, slots yield their
 * assigned nodes (or fallback content), `display: contents` wrappers are dissolved, and closed
 * `<details>` keep only their summary.
 */
export function childrenOf(cap: Capture, info: ElInfo): FlatChild[] {
  if (info.children) return info.children;
  const out: FlatChild[] = [];
  collectChildren(cap, info.el, out, 0);
  info.children = out;
  return out;
}

function sourceNodes(cap: Capture, el: Element): ArrayLike<Node> {
  const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
  if (shadow) {
    cap.shadowRoots.add(shadow);
    return shadow.childNodes;
  }
  if (el.localName === "slot" && typeof (el as HTMLSlotElement).assignedNodes === "function") {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  if (el.localName === "details" && !el.hasAttribute("open")) {
    for (const child of Array.from(el.children)) if (child.localName === "summary") return [child];
    return [];
  }
  return el.childNodes;
}

function collectChildren(cap: Capture, el: Element, out: FlatChild[], depth: number): void {
  const nodes = sourceNodes(cap, el);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Node;
    if (isText(node)) {
      if (node.data.length > 0) out.push({ node, styleParent: el });
    } else if (isElement(node)) {
      if (depth < 32 && infoOf(cap, node).display === "contents") collectChildren(cap, node, out, depth + 1);
      else out.push({ node, styleParent: el });
    }
  }
}

/** Maps a viewport rect into world coordinates for the current context. */
export function toWorld(cap: Capture, ctx: Ctx, r: { left: number; top: number; width: number; height: number }): Rect {
  let y = r.top + ctx.dy;
  let h = r.height;
  const shell = cap.shell;
  if (shell && ctx.outsideShell) {
    if (r.top >= shell.vBottom - 1) y += shell.delta;
    else if (r.top <= shell.vTop + 1 && r.top + r.height >= shell.vBottom - 1) h += shell.delta;
  }
  return { x: r.left + ctx.dx, y, w: r.width, h };
}

const MIN_OPACITY = 0.02;

const PREFIX: Record<Layer["kind"], string> = {
  box: "b",
  text: "t",
  path: "p",
  image: "i",
  media: "m",
  guide: "g",
  custom: "c",
};

/** Draft of a layer before the capture assigns its id. */
export type Draft<L extends Layer> = Omit<L, "id">;

/**
 * Adds a layer: applies the context clip (skipping fully clipped layers), world bounds, maxHeight,
 * accumulated opacity and the default parent, then records its paint key.
 * Returns the new id, or null when the layer is not visible.
 */
export function emit<L extends Layer>(cap: Capture, ctx: Ctx, draft: Draft<L>): string | null {
  // Content under an accumulated opacity this low is invisible in practice.
  if (ctx.opacity < MIN_OPACITY) return null;
  const box = draft.kind === "text" ? outwardRect(draft.box) : roundRect(draft.box);
  if (box.w <= 0 || box.h <= 0) return null;
  if (box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= cap.worldW) return null;
  let clip: Rect | undefined;
  if (ctx.clip) {
    if (!intersect(box, ctx.clip)) return null;
    if (!contains(ctx.clip, box)) clip = roundRect(ctx.clip);
  }
  if (box.y >= cap.opts.maxHeight) {
    cap.droppedHeight++;
    return null;
  }
  // Safety net for huge pages; fixed UI is exempt so a toolbar late in the DOM is never lost.
  if (cap.layers.length >= cap.hardLimit && !ctx.inFixed) {
    cap.overflow++;
    return null;
  }
  const id = `${PREFIX[draft.kind]}${++cap.seq}`;
  const layer = { id, ...draft, box } as L;
  if (clip) layer.clip = clip;
  if (layer.parent === undefined && ctx.parentId) layer.parent = ctx.parentId;
  if (ctx.opacity < 0.999) layer.opacity = Math.round(ctx.opacity * 1000) / 1000;
  cap.layers.push(layer);
  cap.keys.push(ctx.paintKey);
  if (ctx.inFixed) cap.fixedIds.add(id);
  cap.maxBottom = Math.max(cap.maxBottom, Math.min(box.y + box.h, cap.opts.maxHeight));
  return id;
}

export function openNode(cap: Capture, el: Element, box: Rect): NodeRec {
  const rec: NodeRec = {
    tag: el.localName,
    classes: typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? ""),
    box,
    start: cap.layers.length,
    end: cap.layers.length,
    children: [],
  };
  cap.nodes.push(rec);
  return rec;
}

export function closeNode(cap: Capture, rec: NodeRec): void {
  cap.nodes.pop();
  rec.end = cap.layers.length;
  if (rec.end > rec.start) cap.nodes[cap.nodes.length - 1]?.children.push(rec);
}
