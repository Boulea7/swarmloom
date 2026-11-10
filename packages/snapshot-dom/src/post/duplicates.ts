import type { Layer, Rect } from "@swarmloom/core";

/** Element subtree with the half-open range of layers it emitted. */
export interface DupNode {
  tag: string;
  classes: string;
  box: Rect;
  start: number;
  end: number;
  children: DupNode[];
}

/** Largest subtree (in layers) that is still treated as one repeatable unit. */
const MAX_MEMBER_LAYERS = 120;
/** Largest group (master included); further members start a new group. */
const MAX_GROUP = 64;
/** Members taller than this are page sections, not repeated items. */
const MAX_MEMBER_HEIGHT = 1400;
/** Single-text members longer than this are prose, which should be typed rather than copied. */
const MAX_SINGLE_TEXT = 80;
const PROSE_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);

function tokens(classes: string): Set<string> {
  return new Set(classes.split(/\s+/).filter((t) => t.length > 0));
}

/** Jaccard similarity of two class-token sets (1 when both are empty). */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function fingerprint(n: DupNode, layers: readonly Layer[]): string {
  let s = n.tag;
  for (let i = n.start; i < n.end; i++) s += `|${(layers[i] as Layer).kind[0]}`;
  return s;
}

function eligible(n: DupNode, layers: readonly Layer[]): boolean {
  const count = n.end - n.start;
  if (count === 0 || count > MAX_MEMBER_LAYERS || n.box.h > MAX_MEMBER_HEIGHT) return false;
  if (count === 1) {
    const only = layers[n.start] as Layer;
    if (only.kind === "text" && (only.text.length > MAX_SINGLE_TEXT || PROSE_TAGS.has(n.tag))) return false;
    if (only.kind === "guide" || only.kind === "custom") return false;
  }
  for (let i = n.start; i < n.end; i++) if ((layers[i] as Layer).master) return false;
  return true;
}

function allText(n: DupNode, layers: readonly Layer[]): boolean {
  for (let i = n.start; i < n.end; i++) if ((layers[i] as Layer).kind !== "text") return false;
  return true;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.2 * Math.max(a, b) + 4;
}

/**
 * One dimension must match within 20% while the other may vary (rows of a list share a width,
 * items of a strip share a height). Text-only members (links, chips) only need a similar height.
 */
function similarSize(a: Rect, b: Rect, textOnly: boolean): boolean {
  if (textOnly) return close(a.h, b.h);
  return close(a.w, b.w) || close(a.h, b.h);
}

function readingOrder(a: DupNode, b: DupNode): number {
  return Math.round(a.box.y) - Math.round(b.box.y) || a.box.x - b.box.x || a.start - b.start;
}

/**
 * Marks repeated sibling subtrees (nav links, cards, list rows, logo strips) as duplicates: the
 * first member of each group is the master and every layer of the other members gets `master`
 * set to the corresponding layer of the master. Members must share tag, layer-kind sequence,
 * similar classes and a similar size; groups hold 2-64 members. Returns the number of layers marked.
 */
export function detectDuplicates(root: DupNode, layers: readonly Layer[]): number {
  let marked = 0;
  const visit = (node: DupNode, depth: number): void => {
    if (depth > 200) return;
    const grouped = new Set<DupNode>();
    const byPrint = new Map<string, DupNode[]>();
    for (const child of node.children) {
      if (!eligible(child, layers)) continue;
      const key = fingerprint(child, layers);
      const list = byPrint.get(key);
      if (list) list.push(child);
      else byPrint.set(key, [child]);
    }
    for (const candidates of byPrint.values()) {
      if (candidates.length < 2) continue;
      // The master is the first member in reading order.
      const pool = [...candidates].sort(readingOrder);
      while (pool.length >= 2) {
        const master = pool.shift() as DupNode;
        const mTokens = tokens(master.classes);
        const textOnly = allText(master, layers);
        const members: DupNode[] = [];
        for (let i = 0; i < pool.length && members.length + 1 < MAX_GROUP; i++) {
          const c = pool[i] as DupNode;
          if (jaccard(mTokens, tokens(c.classes)) >= 0.5 && similarSize(master.box, c.box, textOnly)) {
            members.push(c);
            pool.splice(i, 1);
            i--;
          }
        }
        const count = master.end - master.start;
        const minGroup = count >= 2 ? 2 : 3;
        if (members.length + 1 < minGroup) continue;
        grouped.add(master);
        for (const m of members) {
          grouped.add(m);
          for (let i = 0; i < count; i++) {
            const dup = layers[m.start + i] as Layer;
            dup.master = (layers[master.start + i] as Layer).id;
            marked++;
          }
        }
      }
    }
    for (const child of node.children) if (!grouped.has(child)) visit(child, depth + 1);
  };
  visit(root, 0);
  return marked;
}
