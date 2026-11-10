/**
 * SVG path data parser (SVG 2 path grammar, section 9.3.9).
 *
 * The scanner works character by character (no regex number splitting) so compact forms such as
 * `M0.5.5`, `1e-3-2`, implicit command repetition and arc flags written without separators
 * (`a1 1 0 00 1 1`) parse exactly like browsers do. Output is normalised to absolute
 * `M`/`L`/`C`/`Q`/`A`/`Z` segments: `H`/`V` become `L`, `S` becomes `C` and `T` becomes `Q` with the
 * reflected control point. On malformed input the segments parsed so far are returned together
 * with an error, mirroring the "render up to the first error" rule of the specification.
 */

export interface MoveSegment {
  type: "M";
  x: number;
  y: number;
}

export interface LineSegment {
  type: "L";
  x: number;
  y: number;
}

export interface CubicSegment {
  type: "C";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

export interface QuadSegment {
  type: "Q";
  x1: number;
  y1: number;
  x: number;
  y: number;
}

export interface ArcSegment {
  type: "A";
  rx: number;
  ry: number;
  /** X-axis rotation in degrees. */
  rotation: number;
  largeArc: boolean;
  sweep: boolean;
  x: number;
  y: number;
}

export interface CloseSegment {
  type: "Z";
}

/** One absolute, normalised path segment. */
export type PathSegment = MoveSegment | LineSegment | CubicSegment | QuadSegment | ArcSegment | CloseSegment;

export interface ParsedPath {
  segments: PathSegment[];
  /** Set when parsing stopped early; `segments` then holds everything before the error. */
  error?: string;
}

/** Number of arguments per command letter (lower case). */
const ARG_COUNT: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Character codes used by the scanner. */
const Code = {
  Space: 0x20,
  Tab: 0x09,
  LineFeed: 0x0a,
  FormFeed: 0x0c,
  CarriageReturn: 0x0d,
  Comma: 0x2c,
  Plus: 0x2b,
  Minus: 0x2d,
  Dot: 0x2e,
  Zero: 0x30,
  Nine: 0x39,
  LowerE: 0x65,
  UpperE: 0x45,
} as const;

function isWsp(c: number): boolean {
  return c === Code.Space || c === Code.Tab || c === Code.LineFeed || c === Code.FormFeed || c === Code.CarriageReturn;
}

function isDigit(c: number): boolean {
  return c >= Code.Zero && c <= Code.Nine;
}

function startsNumber(c: number): boolean {
  return isDigit(c) || c === Code.Plus || c === Code.Minus || c === Code.Dot;
}

class Scanner {
  pos = 0;
  constructor(private readonly src: string) {}

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  peek(): number {
    return this.src.charCodeAt(this.pos);
  }

  char(): string {
    return this.src.charAt(this.pos);
  }

  skipWsp(): void {
    while (this.pos < this.src.length && isWsp(this.src.charCodeAt(this.pos))) this.pos++;
  }

  /** Whitespace with at most one comma, as allowed between arguments. */
  skipSeparator(): void {
    this.skipWsp();
    if (this.pos < this.src.length && this.src.charCodeAt(this.pos) === Code.Comma) {
      this.pos++;
      this.skipWsp();
    }
  }

  /** Reads one SVG number; returns NaN (without consuming) when none starts here. */
  number(): number {
    const s = this.src;
    const start = this.pos;
    let i = start;
    let c = s.charCodeAt(i);
    if (c === Code.Plus || c === Code.Minus) c = s.charCodeAt(++i);
    let digits = 0;
    while (isDigit(c)) {
      c = s.charCodeAt(++i);
      digits++;
    }
    if (c === Code.Dot) {
      c = s.charCodeAt(++i);
      while (isDigit(c)) {
        c = s.charCodeAt(++i);
        digits++;
      }
    }
    if (digits === 0) return Number.NaN;
    if (c === Code.LowerE || c === Code.UpperE) {
      // An exponent only counts when digits follow; otherwise the "e" is left for the caller.
      let j = i + 1;
      let e = s.charCodeAt(j);
      if (e === Code.Plus || e === Code.Minus) e = s.charCodeAt(++j);
      if (isDigit(e)) {
        while (isDigit(e)) e = s.charCodeAt(++j);
        i = j;
      }
    }
    this.pos = i;
    return Number(s.slice(start, i));
  }

  /** Reads an arc flag: a single `0` or `1`. */
  flag(): number {
    const c = this.src.charCodeAt(this.pos);
    if (c === Code.Zero || c === Code.Zero + 1) {
      this.pos++;
      return c - Code.Zero;
    }
    return Number.NaN;
  }
}

/** Mutable pen state while normalising. */
interface PenState {
  x: number;
  y: number;
  /** Start of the current subpath (target of Z). */
  sx: number;
  sy: number;
  /** Last cubic second control point / quadratic control point, for S and T reflection. */
  cx: number;
  cy: number;
  prev: string;
}

function readArgs(scan: Scanner, cmd: string, out: number[]): boolean {
  const count = ARG_COUNT[cmd] ?? 0;
  for (let k = 0; k < count; k++) {
    if (k > 0) scan.skipSeparator();
    const isFlag = cmd === "a" && (k === 3 || k === 4);
    const value = isFlag ? scan.flag() : scan.number();
    if (!Number.isFinite(value)) return false;
    out[k] = value;
  }
  return true;
}

function emit(cmdLetter: string, a: number[], pen: PenState, out: PathSegment[]): void {
  const lower = cmdLetter.toLowerCase();
  const rel = cmdLetter !== cmdLetter.toUpperCase();
  const ox = rel ? pen.x : 0;
  const oy = rel ? pen.y : 0;
  const at = (i: number): number => a[i] ?? 0;
  switch (lower) {
    case "m": {
      pen.x = at(0) + ox;
      pen.y = at(1) + oy;
      pen.sx = pen.x;
      pen.sy = pen.y;
      out.push({ type: "M", x: pen.x, y: pen.y });
      break;
    }
    case "l":
    case "h":
    case "v":
    case "t": {
      let x = pen.x;
      let y = pen.y;
      if (lower === "l" || lower === "t") {
        x = at(0) + ox;
        y = at(1) + oy;
      } else if (lower === "h") {
        x = at(0) + (rel ? pen.x : 0);
      } else {
        y = at(0) + (rel ? pen.y : 0);
      }
      if (lower === "t") {
        const reflect = pen.prev === "q" || pen.prev === "t";
        const x1 = reflect ? 2 * pen.x - pen.cx : pen.x;
        const y1 = reflect ? 2 * pen.y - pen.cy : pen.y;
        out.push({ type: "Q", x1, y1, x, y });
        pen.cx = x1;
        pen.cy = y1;
      } else {
        out.push({ type: "L", x, y });
      }
      pen.x = x;
      pen.y = y;
      break;
    }
    case "c":
    case "s": {
      let x1: number;
      let y1: number;
      let k = 0;
      if (lower === "c") {
        x1 = at(0) + ox;
        y1 = at(1) + oy;
        k = 2;
      } else {
        const reflect = pen.prev === "c" || pen.prev === "s";
        x1 = reflect ? 2 * pen.x - pen.cx : pen.x;
        y1 = reflect ? 2 * pen.y - pen.cy : pen.y;
      }
      const x2 = at(k) + ox;
      const y2 = at(k + 1) + oy;
      const x = at(k + 2) + ox;
      const y = at(k + 3) + oy;
      out.push({ type: "C", x1, y1, x2, y2, x, y });
      pen.cx = x2;
      pen.cy = y2;
      pen.x = x;
      pen.y = y;
      break;
    }
    case "q": {
      const x1 = at(0) + ox;
      const y1 = at(1) + oy;
      const x = at(2) + ox;
      const y = at(3) + oy;
      out.push({ type: "Q", x1, y1, x, y });
      pen.cx = x1;
      pen.cy = y1;
      pen.x = x;
      pen.y = y;
      break;
    }
    case "a": {
      const x = at(5) + ox;
      const y = at(6) + oy;
      const rx = Math.abs(at(0));
      const ry = Math.abs(at(1));
      if (rx === 0 || ry === 0) {
        // Zero radii draw a straight line (SVG 2, B.2.5).
        out.push({ type: "L", x, y });
      } else {
        out.push({ type: "A", rx, ry, rotation: at(2), largeArc: at(3) === 1, sweep: at(4) === 1, x, y });
      }
      pen.x = x;
      pen.y = y;
      break;
    }
    case "z": {
      out.push({ type: "Z" });
      pen.x = pen.sx;
      pen.y = pen.sy;
      break;
    }
  }
  pen.prev = lower;
}

/**
 * Parses SVG path data into absolute, normalised segments.
 *
 * @param d - The `d` attribute value.
 * @param maxSegments - Hard cap on emitted segments; parsing stops with an error when exceeded.
 */
export function parsePathData(d: string, maxSegments = 200_000): ParsedPath {
  const segments: PathSegment[] = [];
  const scan = new Scanner(d);
  const pen: PenState = { x: 0, y: 0, sx: 0, sy: 0, cx: 0, cy: 0, prev: "" };
  const args: number[] = [0, 0, 0, 0, 0, 0, 0];
  const fail = (message: string): ParsedPath => ({ segments, error: `${message} at offset ${scan.pos}` });

  scan.skipWsp();
  while (!scan.done) {
    const letter = scan.char();
    const lower = letter.toLowerCase();
    if (!Object.hasOwn(ARG_COUNT, lower)) return fail(`unexpected "${letter}"`);
    if (segments.length === 0 && lower !== "m") return fail("path data must start with a moveto");
    scan.pos++;
    scan.skipWsp();

    if (lower === "z") {
      emit(letter, args, pen, segments);
      continue;
    }

    // First argument set is mandatory; further sets repeat the command implicitly
    // (a moveto repeats as lineto).
    let cmd = letter;
    let first = true;
    while (first || (!scan.done && startsNumber(scan.peek()))) {
      if (!readArgs(scan, lower, args)) return fail(`bad argument for "${letter}"`);
      emit(cmd, args, pen, segments);
      if (segments.length > maxSegments) return fail(`more than ${maxSegments} segments`);
      if (lower === "m") cmd = letter === "m" ? "l" : "L";
      first = false;
      scan.skipSeparator();
    }
  }
  return { segments };
}

/**
 * Parses a comma/whitespace separated list of numbers (e.g. `points`, `viewBox`), stopping at the
 * first token that is not a number.
 */
export function parseNumberList(value: string): number[] {
  const out: number[] = [];
  const scan = new Scanner(value);
  scan.skipWsp();
  while (!scan.done) {
    const v = scan.number();
    if (!Number.isFinite(v)) break;
    out.push(v);
    scan.skipSeparator();
  }
  return out;
}
