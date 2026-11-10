import type { Blueprint, Layer } from "../types";
import { DEFAULT_ESTIMATE_MS } from "./constants";
import { IndexHeap } from "./heap";
import { type RoleKey, roleFor } from "./labels";

/** Node builds a guide (rulers come up, pickers prefer it). */
export const FLAG_GUIDE = 1;
/** Node snaps to a guide while being built. */
export const FLAG_SNAPS = 2;
/** Virtual node with no work: completes as soon as its dependencies have. */
export const FLAG_GATE = 4;

/** Longest estimate accepted from a choreography helper. */
const MAX_ESTIMATE_MS = 120_000;
/** Vertical tolerance for "same row" in reading order. */
const ROW_BAND_PX = 12;

/**
 * Immutable task graph built once per blueprint and reused across replays.
 *
 * Nodes `0..taskCount-1` are layer tasks, in the same order as `layers`; nodes from `taskCount`
 * on are gates (e.g. "the whole master subtree is built"). Edges point from a dependency to its
 * dependents and are stored in CSR form: dependents of `v` are `outList[outStart[v]..outStart[v+1])`.
 */
export interface Plan {
  readonly nodeCount: number;
  readonly taskCount: number;
  readonly layers: readonly Layer[];
  /** Choreography key per task: "duplicate", the layer kind, or CustomLayer.task. */
  readonly keys: readonly string[];
  readonly roles: readonly RoleKey[];
  /** Layer box per task (non-finite values sanitized to 0). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly w: Float64Array;
  readonly h: Float64Array;
  /** Reading-order rank per node (gates: -1). */
  readonly rank: Float64Array;
  /** Dense rank of Layer.priority per task (0 when no layer sets a priority). */
  readonly tier: Float64Array;
  /** A task becomes available once the unlock boundary reaches this y (per node). */
  readonly unlockY: Float64Array;
  /** Estimated task duration at speed 1, engine ms (per task). */
  readonly estimate: Float64Array;
  readonly flags: Uint8Array;
  /** Number of dependencies per node. */
  readonly deps: Int32Array;
  readonly outStart: Int32Array;
  readonly outList: Int32Array;
  /** Tasks in a topological order that follows reading order where the graph allows. */
  readonly order: Int32Array;
  /** Tasks sorted by top edge (then rank): drives the tour frontier. */
  readonly byTop: Int32Array;
  readonly totalEstimate: number;
  /** Human-readable notes about skipped layers, dangling references and broken cycles. */
  readonly diagnostics: readonly string[];
}

export interface PlanOptions {
  /** Estimated duration of a layer's task at speed 1 (usually choreoHelpers.estimate). */
  estimate(layer: Layer): number;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function isLayer(v: unknown): v is Layer {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Partial<Layer>;
  return typeof l.id === "string" && typeof l.kind === "string" && typeof l.box === "object" && l.box !== null;
}

class GraphBuilder {
  readonly outs: number[][] = [];
  readonly ins: number[][] = [];

  addNode(): number {
    this.outs.push([]);
    this.ins.push([]);
    return this.outs.length - 1;
  }

  addEdge(from: number, to: number): void {
    if (from === to) return;
    const out = this.outs[from] as number[];
    if (out.includes(to)) return;
    out.push(to);
    (this.ins[to] as number[]).push(from);
  }

  removeEdge(from: number, to: number): void {
    const out = this.outs[from] as number[];
    const at = out.indexOf(to);
    if (at >= 0) out.splice(at, 1);
    const inn = this.ins[to] as number[];
    const back = inn.indexOf(from);
    if (back >= 0) inn.splice(back, 1);
  }
}

/**
 * Builds the task graph of a blueprint.
 *
 * Rules: a parent is built before its children; a duplicate waits for its master and the
 * master's whole subtree (so the copy shows finished content); a layer that snaps to a guide
 * waits for that guide. Dangling references are ignored, cycles are broken at the earliest
 * layer in reading order, and both are reported in `diagnostics` rather than thrown.
 */
export function buildPlan(blueprint: Blueprint, opts: PlanOptions): Plan {
  const diagnostics: string[] = [];
  const layers: Layer[] = [];
  const indexById = new Map<string, number>();
  let invalid = 0;
  let duplicateIds = 0;
  for (const layer of blueprint.layers) {
    if (!isLayer(layer)) invalid++;
    else if (indexById.has(layer.id)) duplicateIds++;
    else {
      indexById.set(layer.id, layers.length);
      layers.push(layer);
    }
  }
  if (invalid > 0) diagnostics.push(`${invalid} malformed layer(s) skipped`);
  if (duplicateIds > 0) diagnostics.push(`${duplicateIds} layer(s) with an already used id skipped`);

  const n = layers.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const w = new Float64Array(n);
  const h = new Float64Array(n);
  const keys: string[] = [];
  const roles: RoleKey[] = [];
  const graph = new GraphBuilder();
  const parentOf = new Int32Array(n).fill(-1);
  let dangling = 0;

  const resolve = (ref: unknown, self: number): number => {
    if (typeof ref !== "string") return -1;
    const at = indexById.get(ref);
    if (at === undefined || at === self) {
      dangling++;
      return -1;
    }
    return at;
  };

  for (let i = 0; i < n; i++) {
    const layer = layers[i] as Layer;
    graph.addNode();
    x[i] = finiteOr(layer.box.x, 0);
    y[i] = finiteOr(layer.box.y, 0);
    w[i] = Math.max(0, finiteOr(layer.box.w, 0));
    h[i] = Math.max(0, finiteOr(layer.box.h, 0));
    if (layer.parent !== undefined) parentOf[i] = resolve(layer.parent, i);
  }

  const flags: number[] = new Array<number>(n).fill(0);
  const masterOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const layer = layers[i] as Layer;
    if (layer.master !== undefined) masterOf[i] = resolve(layer.master, i);
    keys.push(masterOf[i] >= 0 ? "duplicate" : layer.kind === "custom" ? String(layer.task) : layer.kind);
    roles.push(roleFor(keys[i] as string, layer));
    if (layer.kind === "guide") flags[i] = FLAG_GUIDE;
    const parent = parentOf[i] as number;
    if (parent >= 0) graph.addEdge(parent, i);
    for (const ref of Array.isArray(layer.snaps) ? layer.snaps : []) {
      const g = resolve(ref, i);
      if (g >= 0 && (layers[g] as Layer).kind === "guide") {
        graph.addEdge(g, i);
        flags[i] = (flags[i] as number) | FLAG_SNAPS;
      }
    }
  }
  if (dangling > 0) diagnostics.push(`${dangling} reference(s) to missing layers ignored`);

  addMasterGates(graph, flags, parentOf, masterOf);

  const nodeCount = graph.outs.length;
  const tier = priorityTiers(layers);
  const rank = new Float64Array(nodeCount).fill(-1);
  readingOrder(layers, x, y, tier).forEach((task, r) => {
    rank[task] = r;
  });

  const topo = topologicalOrder(graph, rank, n, layers, diagnostics);

  const unlockY = new Float64Array(nodeCount).fill(Number.POSITIVE_INFINITY);
  unlockY.set(y);
  for (let k = nodeCount - 1; k >= 0; k--) {
    const v = topo[k] as number;
    for (const dependent of graph.outs[v] as number[]) {
      if ((unlockY[dependent] as number) < (unlockY[v] as number)) unlockY[v] = unlockY[dependent] as number;
    }
  }

  const deps = new Int32Array(nodeCount);
  const outStart = new Int32Array(nodeCount + 1);
  for (let v = 0; v < nodeCount; v++) {
    deps[v] = (graph.ins[v] as number[]).length;
    outStart[v + 1] = (outStart[v] as number) + (graph.outs[v] as number[]).length;
  }
  const outList = new Int32Array(outStart[nodeCount] as number);
  for (let v = 0; v < nodeCount; v++) outList.set(graph.outs[v] as number[], outStart[v] as number);

  const estimate = new Float64Array(n);
  let totalEstimate = 0;
  for (let i = 0; i < n; i++) {
    estimate[i] = safeEstimate(opts, layers[i] as Layer);
    totalEstimate += estimate[i] as number;
  }

  const order = Int32Array.from(topo.filter((v) => v < n));
  const byTop = Int32Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (y[a] as number) - (y[b] as number) || (rank[a] as number) - (rank[b] as number),
  );

  return {
    nodeCount,
    taskCount: n,
    layers,
    keys,
    roles,
    x,
    y,
    w,
    h,
    rank,
    tier,
    unlockY,
    estimate,
    flags: Uint8Array.from(flags),
    deps,
    outStart,
    outList,
    order,
    byTop,
    totalEstimate,
    diagnostics,
  };
}

function safeEstimate(opts: PlanOptions, layer: Layer): number {
  let e: number;
  try {
    e = opts.estimate(layer);
  } catch {
    return DEFAULT_ESTIMATE_MS;
  }
  return Number.isFinite(e) && e > 0 ? Math.min(e, MAX_ESTIMATE_MS) : DEFAULT_ESTIMATE_MS;
}

/**
 * Duplicates wait for a gate that completes when every layer of the master's subtree is built.
 * A duplicate nested inside its own master falls back to waiting for the master alone.
 */
function addMasterGates(graph: GraphBuilder, flags: number[], parentOf: Int32Array, masterOf: Int32Array): void {
  const n = parentOf.length;
  let children: number[][] | null = null;
  const gates = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const master = masterOf[i] as number;
    if (master < 0) continue;
    if (isAncestor(parentOf, master, i)) {
      graph.addEdge(master, i);
      continue;
    }
    let gate = gates.get(master);
    if (gate === undefined) {
      children ??= childLists(parentOf);
      gate = graph.addNode();
      flags.push(FLAG_GATE);
      gates.set(master, gate);
      for (const member of subtree(children, master)) graph.addEdge(member, gate);
    }
    graph.addEdge(gate, i);
  }
}

function isAncestor(parentOf: Int32Array, ancestor: number, node: number): boolean {
  // Bounded walk: parent cycles in malformed input must not hang the planner.
  let p = parentOf[node] as number;
  for (let steps = 0; p >= 0 && steps < parentOf.length; steps++) {
    if (p === ancestor) return true;
    p = parentOf[p] as number;
  }
  return false;
}

function childLists(parentOf: Int32Array): number[][] {
  const lists: number[][] = Array.from({ length: parentOf.length }, () => []);
  parentOf.forEach((p, i) => {
    if (p >= 0) (lists[p] as number[]).push(i);
  });
  return lists;
}

function subtree(children: number[][], root: number): number[] {
  const seen = new Set<number>([root]);
  const stack = [root];
  while (stack.length > 0) {
    const v = stack.pop() as number;
    for (const c of children[v] as number[]) {
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
    }
  }
  return [...seen];
}

function priorityTiers(layers: readonly Layer[]): Float64Array {
  const values = layers.map((l) => finiteOr(l.priority, 0));
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  const tierOf = new Map(distinct.map((v, i) => [v, i]));
  return Float64Array.from(values, (v) => tierOf.get(v) ?? 0);
}

/** Task indices in reading order: priority tier, then rows top to bottom, then left to right. */
function readingOrder(layers: readonly Layer[], x: Float64Array, y: Float64Array, tier: Float64Array): number[] {
  const band = (i: number): number => Math.floor(((y[i] as number) + ROW_BAND_PX / 2) / ROW_BAND_PX);
  return Array.from({ length: layers.length }, (_, i) => i).sort(
    (a, b) =>
      (tier[a] as number) - (tier[b] as number) || band(a) - band(b) || (x[a] as number) - (x[b] as number) || a - b,
  );
}

/**
 * Kahn's algorithm with a reading-rank heap. When only cycles remain, the cycle is broken at
 * the earliest real task by dropping its edges from not-yet-ordered nodes.
 */
function topologicalOrder(
  graph: GraphBuilder,
  rank: Float64Array,
  taskCount: number,
  layers: readonly Layer[],
  diagnostics: string[],
): Int32Array {
  const nodeCount = graph.outs.length;
  const remaining = Int32Array.from(graph.ins, (inn) => inn.length);
  const placed = new Uint8Array(nodeCount);
  const heap = new IndexHeap(nodeCount, rank);
  const topo = new Int32Array(nodeCount);
  for (let v = 0; v < nodeCount; v++) if (remaining[v] === 0) heap.push(v);
  let count = 0;
  let broken = 0;
  while (count < nodeCount) {
    if (heap.size === 0) {
      const victim = cycleVictim(placed, rank, taskCount);
      for (const from of [...(graph.ins[victim] as number[])]) {
        if (!placed[from]) graph.removeEdge(from, victim);
      }
      remaining[victim] = 0;
      heap.push(victim);
      if (broken++ < 3) {
        const id = victim < taskCount ? (layers[victim] as Layer).id : `#gate${victim}`;
        diagnostics.push(`dependency cycle broken at layer "${id}"`);
      }
    }
    const v = heap.pop();
    placed[v] = 1;
    topo[count++] = v;
    for (const dependent of graph.outs[v] as number[]) {
      remaining[dependent] = (remaining[dependent] as number) - 1;
      if (remaining[dependent] === 0) heap.push(dependent);
    }
  }
  if (broken > 3) diagnostics.push(`${broken - 3} more dependency cycle(s) broken`);
  return topo;
}

function cycleVictim(placed: Uint8Array, rank: Float64Array, taskCount: number): number {
  let best = -1;
  for (let v = 0; v < placed.length; v++) {
    if (placed[v]) continue;
    // Prefer real tasks (gates have rank -1) so the reported layer is meaningful.
    const key = v < taskCount ? (rank[v] as number) : Number.MAX_VALUE;
    const bestKey = best < 0 ? Number.POSITIVE_INFINITY : best < taskCount ? (rank[best] as number) : Number.MAX_VALUE;
    if (key < bestKey) best = v;
  }
  return best;
}
