/**
 * Minimal SVG path-data reader: extracts the anchor points (command end points) of every subpath.
 * Curves contribute their end points only; lengths are chord lengths between anchors, which is
 * enough for pacing the pen and the trace. Parsing stops at the first malformed token and keeps
 * what was read so far (the final trace still reveals the whole path).
 */

import type { PathReveal, Point } from "../types";
import { distance } from "./geometry";
import { MAX_PATH_POINTS, PEN_MAX_ANCHORS } from "./timing";

export interface PathAnchors {
  /** Anchor points per subpath, stage coordinates; consecutive duplicates removed. */
  subpaths: Point[][];
  /** Sum of chord lengths over all subpaths (moves between subpaths excluded). */
  length: number;
  /** Total anchors over all subpaths. */
  count: number;
  /** True when parsing stopped early (malformed data or the point limit). */
  truncated: boolean;
}

const PARAMS: Readonly<Record<string, number>> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const SEPARATOR = /[\s,]/;

class Reader {
  i = 0;
  constructor(readonly s: string) {}

  skip(): void {
    while (this.i < this.s.length && SEPARATOR.test(this.s.charAt(this.i))) this.i++;
  }

  get done(): boolean {
    return this.i >= this.s.length;
  }

  peek(): string {
    return this.s.charAt(this.i);
  }

  number(): number | null {
    this.skip();
    NUMBER.lastIndex = this.i;
    const match = NUMBER.exec(this.s);
    if (!match) return null;
    this.i = NUMBER.lastIndex;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
  }

  /** Arc flags are single digits and may be written without separators ("a1 1 0 00 1 1"). */
  flag(): number | null {
    this.skip();
    const c = this.peek();
    if (c !== "0" && c !== "1") return null;
    this.i++;
    return c === "1" ? 1 : 0;
  }
}

/** Reads the anchors of SVG path data `d`, keeping at most `maxPoints` points. */
export function parsePathAnchors(d: string, maxPoints = MAX_PATH_POINTS): PathAnchors {
  const subpaths: Point[][] = [];
  const reader = new Reader(typeof d === "string" ? d : "");
  let command = "";
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let sub: Point[] | null = null;
  let count = 0;
  let truncated = false;

  const push = (p: Point): void => {
    if (!sub) {
      sub = [current];
      subpaths.push(sub);
      count++;
    }
    const last = sub[sub.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) {
      sub.push(p);
      count++;
    }
    current = p;
  };

  for (;;) {
    reader.skip();
    if (reader.done) break;
    if (count >= maxPoints) {
      truncated = true;
      break;
    }
    const c = reader.peek();
    if (/[a-z]/i.test(c)) {
      if (PARAMS[c.toLowerCase()] === undefined) {
        truncated = true;
        break;
      }
      command = c;
      reader.i++;
    } else if (!command || command === "z" || command === "Z") {
      // Numbers without a command (or after a closepath) are malformed.
      truncated = true;
      break;
    }
    const lower = command.toLowerCase();
    const relative = command !== command.toUpperCase();
    if (lower === "z") {
      if (sub) push(start);
      sub = null;
      current = start;
      continue;
    }
    const args: number[] = [];
    const arity = PARAMS[lower] ?? 0;
    for (let k = 0; k < arity; k++) {
      const value = lower === "a" && (k === 3 || k === 4) ? reader.flag() : reader.number();
      if (value === null) break;
      args.push(value);
    }
    if (args.length < arity) {
      truncated = true;
      break;
    }
    const ox = relative ? current.x : 0;
    const oy = relative ? current.y : 0;
    let end: Point;
    switch (lower) {
      case "m":
        end = { x: ox + (args[0] ?? 0), y: oy + (args[1] ?? 0) };
        sub = [end];
        subpaths.push(sub);
        count++;
        current = start = end;
        // Further coordinate pairs after a moveto are implicit linetos.
        command = relative ? "l" : "L";
        continue;
      case "h":
        end = { x: ox + (args[0] ?? 0), y: current.y };
        break;
      case "v":
        end = { x: current.x, y: oy + (args[0] ?? 0) };
        break;
      default: {
        // l, t: (x y); s, q: (x1 y1 x y); c: (x1 y1 x2 y2 x y); a: (rx ry rot large sweep x y)
        const n = args.length;
        end = { x: ox + (args[n - 2] ?? 0), y: oy + (args[n - 1] ?? 0) };
      }
    }
    push(end);
  }

  let length = 0;
  for (const points of subpaths) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a && b) length += distance(a, b);
    }
  }
  return { subpaths, length, count, truncated };
}

/**
 * Up to `n` points spread evenly (by chord length) along all subpaths, always including the very
 * first and last anchors. Returns each point with its drawn-length fraction (0..1).
 */
export function samplePath(path: PathAnchors, n: number): Array<{ p: Point; at: number }> {
  const all: Array<{ p: Point; at: number }> = [];
  let walked = 0;
  for (const points of path.subpaths) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[i - 1];
      if (!p) continue;
      if (prev) walked += distance(prev, p);
      all.push({ p, at: path.length > 0 ? walked / path.length : 0 });
    }
  }
  if (all.length <= n) return all;
  const out: Array<{ p: Point; at: number }> = [];
  for (let k = 0; k < n; k++) {
    const goal = n === 1 ? 1 : k / (n - 1);
    // First anchor at or beyond the goal fraction keeps samples on real anchors.
    const hit = all.find((s) => s.at >= goal - 1e-9) ?? all[all.length - 1];
    if (hit && out[out.length - 1] !== hit) out.push(hit);
  }
  return out;
}

/**
 * Reveal used for a path: "fade" when asked for; otherwise the pen for simple paths and a
 * continuous trace for complex ones ("pen" is a preference, clicking hundreds of anchors is not).
 */
export function pathMode(reveal: PathReveal | undefined, path: PathAnchors): PathReveal {
  if (reveal === "fade") return "fade";
  if (reveal === "trace") return "trace";
  return path.count <= PEN_MAX_ANCHORS && !path.truncated ? "pen" : "trace";
}
