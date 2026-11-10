/**
 * pdf.js text content -> runs -> lines -> blocks, all in page CSS px.
 *
 * The text itself is never re-rendered: these boxes only decide which region
 * of the page bitmap each typed crop reveals, and in which order.
 */

import {
  addPoint,
  type Edges,
  emptyEdges,
  intersect,
  isEmpty,
  type Matrix,
  multiply,
  toMatrix,
  union,
} from "./geometry";

/** The parts of a pdf.js `TextItem` this module reads (marked-content entries lack `str` and are skipped). */
export interface PdfTextItem {
  str: string;
  dir?: string;
  transform: ArrayLike<number>;
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

/** The parts of a pdf.js `TextStyle` this module reads. */
export interface PdfTextStyle {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

/** Viewport facts needed to place text: the CSS viewport transform, its scale and the page size. */
export interface PageFrame {
  transform: Matrix;
  scale: number;
  width: number;
  height: number;
}

/** One positioned piece of text (a pdf.js text item). */
export interface TextRun {
  str: string;
  /** Font size in CSS px. */
  size: number;
  /** Direction of the text advance in radians, y pointing down (0 = horizontal). */
  angle: number;
  /** Extent along the advance direction and baseline position across it, CSS px. */
  start: number;
  end: number;
  baseline: number;
  /** Axis-aligned bounds on the page, CSS px. */
  edges: Edges;
  rtl: boolean;
  eol: boolean;
}

/** Runs on one baseline that read as one line. */
export interface TextLine {
  runs: TextRun[];
  text: string;
  size: number;
  angle: number;
  start: number;
  end: number;
  baseline: number;
  edges: Edges;
  rtl: boolean;
}

/** Consecutive lines of the same size and column: a paragraph, a heading, a table cell. */
export interface TextBlock {
  lines: TextLine[];
  size: number;
  edges: Edges;
}

const SAME_ANGLE = 0.02;

/** Ascent as a fraction of the font size, from pdf.js style metrics with the usual 0.8 fallback. */
function ascentRatio(style: PdfTextStyle | undefined): number {
  const ascent = style?.ascent;
  const descent = style?.descent;
  let ratio = 0.8;
  if (typeof ascent === "number" && ascent > 0) ratio = ascent;
  else if (typeof descent === "number" && descent < 0) ratio = 1 + descent;
  return Math.min(1, Math.max(0.5, ratio));
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof (item as PdfTextItem | null)?.str === "string";
}

/**
 * Converts pdf.js text items to runs in page CSS px. Whitespace-only items only
 * carry their end-of-line flag; items outside the page or without size are dropped.
 */
export function toRuns(
  items: readonly unknown[],
  styles: Readonly<Record<string, PdfTextStyle>>,
  frame: PageFrame,
): TextRun[] {
  const page: Edges = { x0: 0, y0: 0, x1: frame.width, y1: frame.height };
  const runs: TextRun[] = [];
  for (const item of items) {
    if (!isTextItem(item)) continue;
    const last = runs[runs.length - 1];
    if (!item.str.trim()) {
      if (item.hasEOL && last) last.eol = true;
      continue;
    }
    const m = toMatrix(item.transform);
    if (!m) continue;
    const tx = multiply(frame.transform, m);
    const style = styles[item.fontName];
    const size = Math.hypot(tx[2], tx[3]);
    if (!(size >= 0.5 && size < 4000)) continue;
    let angle = Math.atan2(tx[1], tx[0]);
    if (style?.vertical) angle += Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rawAdvance = (style?.vertical ? item.height : item.width) * frame.scale;
    const advance = rawAdvance > 0 ? rawAdvance : size * 0.5 * item.str.length;
    const ascent = size * ascentRatio(style);
    const descent = size - ascent;
    const ox = tx[4];
    const oy = tx[5];
    const edges = emptyEdges();
    // Quad: the baseline pushed up by the ascent and down by the descent, extended along the advance.
    for (const [ax, ay] of [
      [ascent * sin, -ascent * cos],
      [-descent * sin, descent * cos],
    ] as const) {
      addPoint(edges, ox + ax, oy + ay);
      addPoint(edges, ox + ax + advance * cos, oy + ay + advance * sin);
    }
    const clipped = intersect(edges, page);
    if (isEmpty(clipped)) continue;
    const start = ox * cos + oy * sin;
    runs.push({
      str: item.str,
      size,
      angle,
      start,
      end: start + advance,
      baseline: -ox * sin + oy * cos,
      edges: clipped,
      rtl: item.dir === "rtl",
      eol: item.hasEOL === true,
    });
  }
  return runs;
}

function joinsLine(line: TextLine, run: TextRun): boolean {
  if (Math.abs(run.angle - line.angle) > SAME_ANGLE) return false;
  const big = Math.max(line.size, run.size);
  if (big / Math.min(line.size, run.size) > 1.8) return false;
  // Superscripts and subscripts sit off the baseline; allow more shift for smaller runs.
  const shift = Math.abs(run.baseline - line.baseline);
  if (shift > (run.size < line.size * 0.85 ? 0.5 : 0.3) * big) return false;
  const gap = run.start - line.end;
  return gap >= -0.5 * big && gap <= 1.2 * big;
}

function appendRun(line: TextLine, run: TextRun): void {
  const gap = run.start - line.end;
  const needsSpace = gap > 0.18 * line.size && !/\s$/.test(line.text) && !/^\s/.test(run.str);
  line.text += (needsSpace ? " " : "") + run.str;
  line.runs.push(run);
  line.start = Math.min(line.start, run.start);
  line.end = Math.max(line.end, run.end);
  line.edges = union(line.edges, run.edges);
}

function startLine(run: TextRun): TextLine {
  return {
    runs: [run],
    text: run.str,
    size: run.size,
    angle: run.angle,
    start: run.start,
    end: run.end,
    baseline: run.baseline,
    edges: { ...run.edges },
    rtl: run.rtl,
  };
}

/** Size carried by most characters (inline bold or italic runs keep it; one big initial does not). */
function dominantSize(weights: Iterable<readonly [size: number, chars: number]>): number {
  const total = new Map<number, number>();
  for (const [size, chars] of weights) {
    const key = Math.round(size * 4) / 4;
    total.set(key, (total.get(key) ?? 0) + chars);
  }
  let best = 0;
  let most = -1;
  for (const [size, chars] of total) {
    if (chars > most || (chars === most && size < best)) {
      best = size;
      most = chars;
    }
  }
  return best;
}

/** Groups consecutive runs (content-stream order) that share a baseline and sit close together. */
export function groupLines(runs: readonly TextRun[]): TextLine[] {
  const lines: TextLine[] = [];
  let current: TextLine | null = null;
  for (const run of runs) {
    if (current && joinsLine(current, run)) appendRun(current, run);
    else {
      current = startLine(run);
      lines.push(current);
    }
    if (run.eol) current = null;
  }
  for (const line of lines) {
    line.size = dominantSize(line.runs.map((r) => [r.size, r.str.length] as const));
    line.rtl = line.runs.filter((r) => r.rtl).length * 2 > line.runs.length;
  }
  return lines;
}

function joinsBlock(block: TextBlock, line: TextLine): boolean {
  const last = block.lines[block.lines.length - 1];
  if (!last || Math.abs(line.angle - last.angle) > SAME_ANGLE) return false;
  if (Math.max(line.size, block.size) / Math.min(line.size, block.size) > 1.1) return false;
  // Line spacing up to 1.75 em keeps a paragraph together; paragraph gaps are usually larger.
  const step = line.baseline - last.baseline;
  if (step < 0.5 * block.size || step > 1.75 * Math.max(line.size, block.size)) return false;
  const first = block.lines[0] as TextLine;
  const start = Math.min(first.start, last.start);
  const end = Math.max(first.end, last.end);
  return line.start < end + block.size && line.end > start - block.size;
}

/** Groups consecutive lines into blocks: same size, one line step apart, overlapping columns. */
export function groupBlocks(lines: readonly TextLine[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;
  for (const line of lines) {
    if (current && joinsBlock(current, line)) {
      current.lines.push(line);
      current.edges = union(current.edges, line.edges);
    } else {
      current = { lines: [line], size: line.size, edges: { ...line.edges } };
      blocks.push(current);
    }
  }
  return blocks;
}

/**
 * Body text size: the size carrying the most characters, rounded to 0.25 px.
 * Pass every block of the document so headings are judged against the whole file.
 */
export function bodySize(blocks: readonly TextBlock[]): number {
  return dominantSize(blocks.flatMap((b) => b.lines.map((l) => [l.size, l.text.length] as const)));
}

/** Blocks set noticeably larger than the body text are headings. */
export function roleOf(block: TextBlock, body: number): "heading" | "paragraph" {
  return body > 0 && block.size >= body * 1.15 ? "heading" : "paragraph";
}
