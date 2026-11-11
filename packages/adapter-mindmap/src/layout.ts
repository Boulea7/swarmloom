/**
 * Deterministic mind map layout: the root in the middle, first-level branches balanced to the
 * left and right by subtree height, every deeper level growing outward. Pure apart from text
 * measurement.
 */

import type { MindMap, MindNode } from "./parse";

export interface PlacedNode {
  node: MindNode;
  depth: number;
  /** -1 left of the root, 1 right, 0 the root itself. */
  side: -1 | 0 | 1;
  /** Index of the first-level branch this node belongs to (-1 for the root). */
  branch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  parent: PlacedNode | null;
}

export interface MindLayout {
  nodes: PlacedNode[];
  width: number;
  height: number;
  /** Uniform scale applied to fit the width. */
  scale: number;
}

/** Measures the advance width of `text` in CSS px for a `font` shorthand. */
export type MeasureText = (text: string, font: string) => number;

export const UI_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif';

interface Level {
  size: number;
  weight: number;
  padX: number;
  padY: number;
  maxW: number;
}

const LEVELS: readonly Level[] = [
  { size: 20, weight: 700, padX: 22, padY: 14, maxW: 280 },
  { size: 15, weight: 600, padX: 14, padY: 8, maxW: 230 },
  { size: 13.5, weight: 500, padX: 10, padY: 5, maxW: 210 },
];
const H_GAP = [64, 48, 36];
const V_GAP = [24, 12, 8];

export function levelOf(depth: number): Level {
  return LEVELS[Math.min(depth, LEVELS.length - 1)] as Level;
}

export function fontOf(depth: number, scale = 1): string {
  const l = levelOf(depth);
  return `${l.weight} ${Math.round(l.size * scale * 10) / 10}px ${UI_FONT}`;
}

/** Canvas-based measurement in `doc`; a width estimate (wide characters count double) without canvas. */
export function createMeasure(doc: Document): MeasureText {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = doc.createElement("canvas").getContext?.("2d") ?? null;
  } catch {
    ctx = null;
  }
  const cache = new Map<string, number>();
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let w = 0;
    if (ctx) {
      ctx.font = font;
      w = ctx.measureText(text).width;
    }
    if (!(w > 0) && text) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 14);
      for (const ch of text) w += (ch.codePointAt(0) as number) > 0x2e80 ? size : size * 0.56;
    }
    if (cache.size < 20_000) cache.set(key, w);
    return w;
  };
}

/** Greedy word wrap; words longer than the line are broken by character. */
function wrap(text: string, font: string, maxW: number, measure: MeasureText): string[] {
  const out: string[] = [];
  for (const para of (text || " ").split("\n")) {
    const tokens = para.match(/[⺀-鿿가-힯豈-﫿]|[^\s⺀-鿿가-힯豈-﫿]+|\s+/g) ?? [""];
    let line = "";
    for (const tok of tokens) {
      const next = line + tok;
      if (line && measure(next.trimEnd(), font) > maxW) {
        out.push(line.trimEnd());
        line = tok.trimStart();
      } else line = next;
      while (measure(line, font) > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), font) > maxW) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
    if (out.length > 8) break;
  }
  if (out.length > 6) {
    out.length = 6;
    out[5] = `${(out[5] as string).replace(/.$/u, "")}…`;
  }
  return out;
}

function size(
  node: MindNode,
  depth: number,
  scale: number,
  measure: MeasureText,
): Pick<PlacedNode, "w" | "h" | "lines" | "fontSize" | "lineHeight"> {
  const l = levelOf(depth);
  const font = fontOf(depth, scale);
  const lines = wrap(node.title || "—", font, l.maxW * scale, measure);
  const textW = Math.max(...lines.map((s) => measure(s, font)), 8 * scale);
  const fontSize = Math.round(l.size * scale * 10) / 10;
  const lineHeight = Math.round(fontSize * 1.32 * 10) / 10;
  return {
    w: Math.ceil(textW + 2 * l.padX * scale + 2),
    h: Math.ceil(lines.length * lineHeight + 2 * l.padY * scale),
    lines,
    fontSize,
    lineHeight,
  };
}

interface Sub {
  node: MindNode;
  depth: number;
  box: ReturnType<typeof size>;
  kids: Sub[];
  /** Height of the whole subtree including gaps. */
  extent: number;
}

function measureTree(node: MindNode, depth: number, scale: number, measure: MeasureText): Sub {
  const box = size(node, depth, scale, measure);
  const kids = node.children.map((c) => measureTree(c, depth + 1, scale, measure));
  const gap = (V_GAP[Math.min(depth + 1, V_GAP.length - 1)] as number) * scale;
  const childrenH = kids.reduce((s, k) => s + k.extent, 0) + Math.max(0, kids.length - 1) * gap;
  return { node, depth, box, kids, extent: Math.max(box.h, childrenH) };
}

/** Splits first-level branches into right and left halves of similar height, keeping their order. */
function balance(kids: Sub[]): { right: Sub[]; left: Sub[] } {
  const hinted = kids.some((k) => k.node.side);
  if (hinted) {
    const right = kids.filter((k) => k.node.side !== "left");
    const left = kids.filter((k) => k.node.side === "left");
    return { right, left };
  }
  if (kids.length <= 1) return { right: kids, left: [] };
  const total = kids.reduce((s, k) => s + k.extent, 0);
  let acc = 0;
  let cut = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < kids.length; i++) {
    acc += (kids[i - 1] as Sub).extent;
    const diff = Math.abs(total - 2 * acc);
    if (diff < best) {
      best = diff;
      cut = i;
    }
  }
  return { right: kids.slice(0, cut), left: kids.slice(cut) };
}

function place(
  sub: Sub,
  parent: PlacedNode,
  side: -1 | 1,
  branch: number,
  top: number,
  scale: number,
  out: PlacedNode[],
): void {
  const hgap = (H_GAP[Math.min(parent.depth, H_GAP.length - 1)] as number) * scale;
  const x = side === 1 ? parent.x + parent.w + hgap : parent.x - hgap - sub.box.w;
  const y = top + (sub.extent - sub.box.h) / 2;
  const placed: PlacedNode = { node: sub.node, depth: sub.depth, side, branch, x, y, ...sub.box, parent };
  out.push(placed);
  placeChildren(sub, placed, side, branch, scale, out);
}

function placeChildren(
  sub: Sub,
  placed: PlacedNode,
  side: -1 | 1,
  branch: number,
  scale: number,
  out: PlacedNode[],
  list: Sub[] = sub.kids,
): void {
  const gap = (V_GAP[Math.min(sub.depth + 1, V_GAP.length - 1)] as number) * scale;
  const total = list.reduce((s, k) => s + k.extent, 0) + Math.max(0, list.length - 1) * gap;
  let top = placed.y + placed.h / 2 - total / 2;
  list.forEach((k, i) => {
    place(k, placed, side, branch < 0 ? i : branch, top, scale, out);
    top += k.extent + gap;
  });
}

function layoutAt(map: MindMap, scale: number, measure: MeasureText, balanced: boolean): MindLayout {
  const tree = measureTree(map.root, 0, scale, measure);
  const root: PlacedNode = { node: map.root, depth: 0, side: 0, branch: -1, x: 0, y: 0, ...tree.box, parent: null };
  const nodes: PlacedNode[] = [root];
  const { right, left } = balanced ? balance(tree.kids) : { right: tree.kids, left: [] };
  root.y = -root.h / 2;
  // Branch indices follow source order across both sides.
  const index = new Map(tree.kids.map((k, i) => [k, i]));
  for (const [list, side] of [
    [right, 1],
    [left, -1],
  ] as const) {
    const gap = (V_GAP[1] as number) * scale;
    const total = list.reduce((s, k) => s + k.extent, 0) + Math.max(0, list.length - 1) * gap;
    let top = -total / 2;
    for (const k of list) {
      place(k, root, side, index.get(k) as number, top, scale, nodes);
      top += k.extent + gap;
    }
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  for (const n of nodes) {
    n.x = Math.round((n.x - minX) * 10) / 10;
    n.y = Math.round((n.y - minY) * 10) / 10;
  }
  return { nodes, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY), scale };
}

/**
 * Lays out a map to fit `maxWidth`: balanced first, then right-only (narrower), then scaled down
 * (not below 0.45; wider maps overflow horizontally and the blueprint grows instead).
 */
export function layoutMindmap(map: MindMap, maxWidth: number, measure: MeasureText): MindLayout {
  let layout = layoutAt(map, 1, measure, true);
  if (layout.width <= maxWidth) return layout;
  const rightOnly = layoutAt(map, 1, measure, false);
  if (rightOnly.width <= maxWidth && rightOnly.height <= layout.height * 2.2) return rightOnly;
  let scale = 1;
  for (let i = 0; i < 8 && layout.width > maxWidth && scale > 0.45; i++) {
    scale = Math.max(0.45, scale * Math.min(0.92, maxWidth / layout.width));
    layout = layoutAt(map, scale, measure, true);
  }
  return layout;
}
