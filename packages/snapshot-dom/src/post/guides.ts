import type { GuideLayer, Layer, Rect, TextLayer } from "@swarmloom/core";

const MIN_MEMBERS = 3;
/** Global cap on guides per blueprint. */
const MAX_GUIDES = 24;
/** Guides allowed per viewport height of content. */
const GUIDES_PER_VIEWPORT = 1.5;
/** Members that perform the snap; the others simply land aligned. */
const SNAPS_PER_GUIDE = 3;
/** Members must be at least this fraction of the body text size. */
const MIN_FONT_RATIO = 0.9;
/** Members must be at least this fraction of the viewport width. */
const MIN_WIDTH_RATIO = 0.08;

export interface GuideDraft {
  axis: "x" | "y";
  pos: number;
  box: Rect;
  members: TextLayer[];
}

export interface GuideParams {
  /** Viewport size in CSS px: width gates small members, height sets the budget. */
  viewport: { w: number; h: number };
  /** World height of the content. */
  height: number;
  /** Device pixel ratio; the clustering tolerance is max(0.5 CSS px, 0.5 device px). */
  dpr: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Single-link clustering on one key: consecutive sorted keys closer than `tol` share a cluster. */
function cluster<T>(items: readonly T[], key: (t: T) => number, tol: number): T[][] {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const out: T[][] = [];
  let cur: T[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const it of sorted) {
    const k = key(it);
    if (k - last > tol && cur.length > 0) {
      out.push(cur);
      cur = [];
    }
    cur.push(it);
    last = k;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Body text size: the font size carrying the most characters. */
export function bodyFontSize(texts: readonly TextLayer[]): number {
  const weight = new Map<number, number>();
  for (const t of texts) {
    const size = t.fontSize ?? 16;
    weight.set(size, (weight.get(size) ?? 0) + t.text.length);
  }
  let best = 16;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight || (w === bestWeight && size < best)) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

function twinKey(t: TextLayer): string {
  return `${Math.round(t.box.x)},${Math.round(t.box.y)},${t.text}`;
}

/** Text layers that may join a guide: not fixed UI, not duplicates or twins, large enough. */
function candidates(layers: readonly Layer[], exclude: ReadonlySet<string>, viewportW: number): TextLayer[] {
  const texts = layers.filter((l): l is TextLayer => l.kind === "text");
  const minFont = bodyFontSize(texts) * MIN_FONT_RATIO;
  const minWidth = viewportW * MIN_WIDTH_RATIO;
  const seen = new Set<string>();
  const out: TextLayer[] = [];
  for (const t of texts) {
    if (t.master || t.transform || exclude.has(t.id)) continue;
    if ((t.fontSize ?? 16) < minFont || t.box.w < minWidth) continue;
    const twin = twinKey(t);
    if (seen.has(twin)) continue;
    seen.add(twin);
    out.push(t);
  }
  return out;
}

/**
 * Finds shared left edges (axis "x": a vertical guide at x = pos) and shared first baselines
 * (axis "y": a horizontal guide at y = pos) across at least three text blocks. `baselines` maps text
 * layer ids to their first baseline in world coordinates; `exclude` lists fixed (screen) layers.
 * The result respects the budget min(24, height / viewport height * 1.5).
 */
export function detectGuides(
  layers: readonly Layer[],
  baselines: ReadonlyMap<string, number>,
  exclude: ReadonlySet<string>,
  params: GuideParams,
): GuideDraft[] {
  const texts = candidates(layers, exclude, params.viewport.w);
  const tol = Math.max(0.5, 0.5 / Math.max(params.dpr, 0.1));
  const drafts: GuideDraft[] = [];
  for (const members of cluster(texts, (t) => t.box.x, tol)) {
    if (members.length < MIN_MEMBERS) continue;
    const pos = median(members.map((m) => m.box.x));
    const top = Math.min(...members.map((m) => m.box.y));
    const bottom = Math.max(...members.map((m) => m.box.y + m.box.h));
    drafts.push({ axis: "x", pos, box: { x: pos, y: top, w: 1, h: bottom - top }, members });
  }
  const withBaseline = texts.filter((t) => baselines.has(t.id));
  for (const group of cluster(withBaseline, (t) => baselines.get(t.id) as number, tol)) {
    // Blocks sharing a first baseline sit side by side: require distinct columns.
    const columns = cluster(group, (t) => t.box.x, tol);
    if (columns.length < MIN_MEMBERS) continue;
    const members = columns.map((c) => c[0] as TextLayer);
    const pos = median(members.map((m) => baselines.get(m.id) as number));
    const left = Math.min(...members.map((m) => m.box.x));
    const right = Math.max(...members.map((m) => m.box.x + m.box.w));
    drafts.push({ axis: "y", pos, box: { x: left, y: pos, w: right - left, h: 1 }, members });
  }
  const vh = params.viewport.h > 0 ? params.viewport.h : params.height;
  const budget = Math.min(MAX_GUIDES, Math.max(1, Math.floor((params.height / Math.max(vh, 1)) * GUIDES_PER_VIEWPORT)));
  drafts.sort((a, b) => b.members.length - a.members.length || a.box.y - b.box.y || a.box.x - b.box.x);
  const kept = drafts.slice(0, budget);
  kept.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return kept;
}

/** Turns guide drafts into guide layers and records snaps on the most prominent members. */
export function applyGuides(drafts: readonly GuideDraft[], nextId: () => string): GuideLayer[] {
  const out: GuideLayer[] = [];
  for (const d of drafts) {
    const id = nextId();
    const pos = Math.round(d.pos * 100) / 100;
    const box: Rect = {
      x: Math.round(d.box.x * 100) / 100,
      y: Math.round(d.box.y * 100) / 100,
      w: Math.round(d.box.w * 100) / 100,
      h: Math.round(d.box.h * 100) / 100,
    };
    out.push({ id, kind: "guide", axis: d.axis, pos, box, meta: { members: d.members.length } });
    const snappers = [...d.members].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0) || a.box.y - b.box.y);
    for (const m of snappers.slice(0, SNAPS_PER_GUIDE)) {
      m.snaps = m.snaps ? [...m.snaps, id] : [id];
    }
  }
  return out;
}
