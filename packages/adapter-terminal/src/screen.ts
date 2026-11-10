/**
 * A small VT100/xterm screen model: enough of the protocol to replay shell sessions.
 *
 * Supported: printable text with autowrap and wide characters, CR/LF/BS/HT, SGR colours and
 * attributes, cursor movement (CUU/CUD/CUF/CUB/CNL/CPL/CHA/VPA/CUP), erase in display/line,
 * insert/delete characters and lines, scroll regions and scrolling, save/restore cursor, the
 * cursor visibility mode, OSC window titles and resizes.
 *
 * The alternate screen (modes 47/1047/1049) is handled minimally: entering it shows a blank
 * screen, leaving it restores the main screen (and, for 1049, the cursor), so the shell prompt
 * returns after a full-screen program exits. Full-screen programs replay best-effort only;
 * `usedAlternate` reports that one ran. Mouse, keypad, charset and query sequences are ignored.
 */

import { type AnsiHandler, AnsiParser } from "./ansi/parser";
import { type Attrs, applySgr, DEFAULT_COLOR, INVERSE, PLAIN, parseParams } from "./ansi/sgr";
import { charWidth } from "./ansi/width";

/** One character cell. `w` is 2 for the first half of a wide character and 0 for its second half. */
export interface Cell {
  readonly ch: string;
  readonly w: 0 | 1 | 2;
  readonly a: Attrs;
}

/** A styled run of cells inside one row. */
export interface Run {
  text: string;
  /** Columns the run occupies. */
  cols: number;
  attrs: Attrs;
}

/** Largest screen accepted (columns x rows). */
export const MAX_COLS = 400;
export const MAX_ROWS = 200;

const BLANK: Cell = Object.freeze({ ch: " ", w: 1, a: PLAIN });
const blankCache = new Map<number, Cell>();

/** Blank cell carrying only the background of `a` (background colour erase). */
function blankFor(a: Attrs): Cell {
  if (a.bg === DEFAULT_COLOR) return BLANK;
  let cell = blankCache.get(a.bg);
  if (!cell) {
    cell = Object.freeze({ ch: " ", w: 1, a: Object.freeze({ fg: DEFAULT_COLOR, bg: a.bg, flags: 0 }) });
    if (blankCache.size < 512) blankCache.set(a.bg, cell);
  }
  return cell;
}

function blankRow(cols: number, cell: Cell = BLANK): Cell[] {
  return new Array<Cell>(cols).fill(cell);
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sanitizeSize(cols: number, rows: number): [number, number] {
  const c = Number.isFinite(cols) ? Math.floor(cols) : 80;
  const r = Number.isFinite(rows) ? Math.floor(rows) : 24;
  return [clampInt(c, 1, MAX_COLS), clampInt(r, 1, MAX_ROWS)];
}

interface SavedCursor {
  x: number;
  y: number;
  attrs: Attrs;
}

export class Screen implements AnsiHandler {
  cols: number;
  rows: number;
  /** Cursor column and row (0-based). */
  x = 0;
  y = 0;
  cursorVisible = true;
  /** Last OSC 0/2 window title. */
  title = "";
  /** True once a program switched to the alternate screen. */
  usedAlternate = false;
  /** Lines scrolled off the top of the full screen (main screen only). */
  scrolledOff = 0;
  /** Highest row index that ever received text or the cursor. */
  maxRow = 0;
  /** Highest column index that ever received a character. */
  maxCol = 0;
  /** True once text wrapped at the right margin. */
  wrapped = false;

  #lines: Cell[][];
  /** Main screen content saved while the alternate screen is active. */
  #mainLines: Cell[][] | null = null;
  #mainCursor: SavedCursor | null = null;
  #attrs: Attrs = PLAIN;
  #wrapPending = false;
  #autowrap = true;
  #top = 0;
  #bottom: number;
  #saved: SavedCursor | null = null;
  #versions: number[];
  #version = 0;
  readonly #parser = new AnsiParser();

  constructor(cols = 80, rows = 24) {
    [this.cols, this.rows] = sanitizeSize(cols, rows);
    this.#lines = Array.from({ length: this.rows }, () => blankRow(this.cols));
    this.#bottom = this.rows - 1;
    this.#versions = new Array<number>(this.rows).fill(0);
  }

  /** Current attributes used for new text. */
  get attrs(): Attrs {
    return this.#attrs;
  }

  /** Feeds terminal output. Escape sequences may be split across calls. */
  write(data: string): void {
    this.#parser.feed(data, this);
  }

  /** Cells of a visible row. */
  row(y: number): readonly Cell[] {
    return this.#lines[y] ?? [];
  }

  /** Change counter of a visible row; it grows whenever the row's content may have changed. */
  rowVersion(y: number): number {
    return this.#versions[y] ?? 0;
  }

  /** Styled runs of a visible row; trailing default-styled blanks are dropped. */
  runs(y: number): Run[] {
    const cells = this.#lines[y];
    if (!cells) return [];
    let end = cells.length;
    while (end > 0) {
      const c = cells[end - 1] as Cell;
      if (c.w === 1 && c.ch === " " && c.a.bg === DEFAULT_COLOR && (c.a.flags & INVERSE) === 0) end--;
      else break;
    }
    const out: Run[] = [];
    let cur: Run | null = null;
    for (let i = 0; i < end; i++) {
      const c = cells[i] as Cell;
      if (c.w === 0) continue;
      if (!cur || cur.attrs !== c.a) {
        cur = { text: "", cols: 0, attrs: c.a };
        out.push(cur);
      }
      cur.text += c.ch;
      cur.cols += c.w;
    }
    return out;
  }

  /** Plain text of the visible screen, one line per row; trailing spaces and empty rows removed. */
  text(): string {
    const lines = this.#lines.map((_, y) => this.lineText(y));
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  /** Plain text of one visible row without trailing spaces. */
  lineText(y: number): string {
    const cells = this.#lines[y] ?? [];
    let s = "";
    for (const c of cells) if (c.w !== 0) s += c.ch;
    return s.trimEnd();
  }

  /** Changes the screen size, keeping the bottom of the content and clamping the cursor. */
  resize(cols: number, rows: number): void {
    const [c, r] = sanitizeSize(cols, rows);
    const fit = (lines: Cell[][]): Cell[][] => {
      let out = lines.map((line) => (line.length >= c ? line.slice(0, c) : [...line, ...blankRow(c - line.length)]));
      if (out.length > r) {
        const drop = Math.max(0, Math.min(out.length - r, this.y - (r - 1)));
        out = out.slice(drop, drop + r);
        if (lines === this.#lines) this.y -= drop;
      }
      while (out.length < r) out.push(blankRow(c));
      return out;
    };
    this.#lines = fit(this.#lines);
    if (this.#mainLines) this.#mainLines = fit(this.#mainLines);
    this.cols = c;
    this.rows = r;
    this.#top = 0;
    this.#bottom = r - 1;
    this.x = clampInt(this.x, 0, c - 1);
    this.y = clampInt(this.y, 0, r - 1);
    this.#wrapPending = false;
    this.#versions = new Array<number>(r).fill(0);
    this.#touchAll();
  }

  /* ------------------------------ AnsiHandler ------------------------------ */

  print(text: string): void {
    for (const ch of text) this.#put(ch, charWidth(ch.codePointAt(0) as number));
  }

  control(code: number): void {
    switch (code) {
      case 0x08:
        this.#wrapPending = false;
        this.x = Math.max(0, this.x - 1);
        break;
      case 0x09:
        this.#wrapPending = false;
        this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
        break;
      case 0x0a:
      case 0x0b:
      case 0x0c:
        this.#wrapPending = false;
        this.#lineFeed();
        break;
      case 0x0d:
        this.#wrapPending = false;
        this.x = 0;
        break;
      default:
      // BEL and other controls have no visible effect.
    }
  }

  csi(priv: string, params: string, inter: string, final: string): void {
    if (priv === "?") {
      if (final === "h" || final === "l") this.#privateMode(params, final === "h");
      return;
    }
    if (priv !== "" || inter !== "") return;
    if (final === "m") {
      this.#attrs = applySgr(this.#attrs, params);
      return;
    }
    const p = parseParams(params).map((g) => g[0] ?? -1);
    const n = Math.max(1, p[0] ?? -1);
    const arg = (i: number, def: number): number => {
      const v = p[i];
      return v === undefined || v < 0 ? def : v;
    };
    this.#wrapPending = false;
    switch (final) {
      case "A":
        this.y = Math.max(this.y >= this.#top ? this.#top : 0, this.y - n);
        break;
      case "B":
      case "e":
        this.y = Math.min(this.y <= this.#bottom ? this.#bottom : this.rows - 1, this.y + n);
        break;
      case "C":
      case "a":
        this.x = Math.min(this.cols - 1, this.x + n);
        break;
      case "D":
        this.x = Math.max(0, this.x - n);
        break;
      case "E":
        this.x = 0;
        this.y = Math.min(this.rows - 1, this.y + n);
        break;
      case "F":
        this.x = 0;
        this.y = Math.max(0, this.y - n);
        break;
      case "G":
      case "`":
        this.x = clampInt(n - 1, 0, this.cols - 1);
        break;
      case "d":
        this.y = clampInt(n - 1, 0, this.rows - 1);
        break;
      case "H":
      case "f":
        this.y = clampInt(Math.max(1, arg(0, 1)) - 1, 0, this.rows - 1);
        this.x = clampInt(Math.max(1, arg(1, 1)) - 1, 0, this.cols - 1);
        break;
      case "J":
        this.#eraseDisplay(arg(0, 0));
        break;
      case "K":
        this.#eraseLine(arg(0, 0));
        break;
      case "X":
        this.#fill(this.y, this.x, Math.min(this.cols, this.x + n));
        break;
      case "P":
        this.#deleteChars(n);
        break;
      case "@":
        this.#insertChars(n);
        break;
      case "L":
        if (this.y >= this.#top && this.y <= this.#bottom) this.#scrollDown(n, this.y);
        break;
      case "M":
        if (this.y >= this.#top && this.y <= this.#bottom) this.#scrollUp(n, this.y);
        break;
      case "S":
        this.#scrollUp(n, this.#top);
        break;
      case "T":
        this.#scrollDown(n, this.#top);
        break;
      case "r": {
        const top = Math.max(1, arg(0, 1)) - 1;
        const bottom = Math.min(this.rows, Math.max(1, arg(1, this.rows))) - 1;
        if (top < bottom) {
          this.#top = top;
          this.#bottom = bottom;
          this.x = 0;
          this.y = 0;
        }
        break;
      }
      case "s":
        this.#save();
        break;
      case "u":
        this.#restore();
        break;
      default:
      // Device queries, insert mode, tab stops and the rest are ignored.
    }
    this.#noteRow();
  }

  esc(inter: string, final: string): void {
    if (inter !== "") return; // charset designations, DEC line attributes
    this.#wrapPending = false;
    switch (final) {
      case "7":
        this.#save();
        break;
      case "8":
        this.#restore();
        break;
      case "D":
        this.#lineFeed();
        break;
      case "E":
        this.x = 0;
        this.#lineFeed();
        break;
      case "M":
        if (this.y === this.#top) this.#scrollDown(1, this.#top);
        else this.y = Math.max(0, this.y - 1);
        break;
      case "c":
        this.#fullReset();
        break;
      default:
      // Keypad modes and the rest are ignored.
    }
  }

  osc(data: string): void {
    const m = /^([02]);([\s\S]*)$/.exec(data);
    if (m?.[2] !== undefined) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from titles.
      this.title = m[2].replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 200);
    }
  }

  /* -------------------------------- internals ------------------------------- */

  #touch(y: number): void {
    if (y >= 0 && y < this.rows) this.#versions[y] = ++this.#version;
  }

  #touchRange(from: number, to: number): void {
    for (let y = from; y <= to; y++) this.#touch(y);
  }

  #touchAll(): void {
    this.#touchRange(0, this.rows - 1);
  }

  #noteRow(): void {
    if (this.y > this.maxRow) this.maxRow = this.y;
  }

  #line(y: number): Cell[] {
    return this.#lines[y] as Cell[];
  }

  #put(ch: string, w: 0 | 1 | 2): void {
    if (w === 0) {
      this.#combine(ch);
      return;
    }
    if (this.#wrapPending && this.#autowrap) {
      this.wrapped = true;
      this.x = 0;
      this.#lineFeed();
    }
    this.#wrapPending = false;
    if (w === 2 && this.x === this.cols - 1 && this.cols > 1) {
      // A wide character never straddles the right margin: it wraps first.
      this.#set(this.y, this.x, blankFor(this.#attrs));
      if (!this.#autowrap) return;
      this.wrapped = true;
      this.x = 0;
      this.#lineFeed();
    }
    const a = this.#attrs;
    this.#set(this.y, this.x, { ch, w, a });
    if (w === 2 && this.x + 1 < this.cols) this.#set(this.y, this.x + 1, { ch: "", w: 0, a });
    this.#touch(this.y);
    this.#noteRow();
    if (this.x + w - 1 > this.maxCol) this.maxCol = Math.min(this.cols - 1, this.x + w - 1);
    const next = this.x + w;
    if (next >= this.cols) {
      this.x = this.cols - 1;
      this.#wrapPending = this.#autowrap;
    } else {
      this.x = next;
    }
  }

  /** Writes one cell, blanking the other half of any wide character it overwrites. */
  #set(y: number, x: number, cell: Cell): void {
    const line = this.#line(y);
    const old = line[x];
    if (old?.w === 0 && x > 0) line[x - 1] = blankFor(old.a);
    if (old?.w === 2 && cell.w !== 2 && x + 1 < this.cols) line[x + 1] = blankFor(old.a);
    line[x] = cell;
  }

  /** Appends a combining mark to the character left of the cursor. */
  #combine(mark: string): void {
    const line = this.#line(this.y);
    let x = this.#wrapPending ? this.x : this.x - 1;
    if (x >= 0 && line[x]?.w === 0) x--;
    const cell = x >= 0 ? line[x] : undefined;
    if (!cell || cell.ch.length > 16) return;
    line[x] = { ch: cell.ch + mark, w: cell.w, a: cell.a };
    this.#touch(this.y);
  }

  #lineFeed(): void {
    if (this.y === this.#bottom) this.#scrollUp(1, this.#top);
    else if (this.y < this.rows - 1) this.y++;
    this.#noteRow();
  }

  /** Scrolls the region [from, bottom] up by n lines (lines leave at `from`). */
  #scrollUp(n: number, from: number): void {
    const bottom = this.#bottom;
    const count = Math.min(n, bottom - from + 1);
    if (count <= 0) return;
    const fill = blankFor(this.#attrs);
    this.#lines.splice(from, count);
    this.#lines.splice(bottom - count + 1, 0, ...Array.from({ length: count }, () => blankRow(this.cols, fill)));
    if (from === 0 && this.#top === 0 && bottom === this.rows - 1 && !this.#mainLines) this.scrolledOff += count;
    this.#touchRange(from, bottom);
  }

  /** Scrolls the region [from, bottom] down by n lines (blank lines enter at `from`). */
  #scrollDown(n: number, from: number): void {
    const bottom = this.#bottom;
    const count = Math.min(n, bottom - from + 1);
    if (count <= 0) return;
    const fill = blankFor(this.#attrs);
    this.#lines.splice(bottom - count + 1, count);
    this.#lines.splice(from, 0, ...Array.from({ length: count }, () => blankRow(this.cols, fill)));
    this.#touchRange(from, bottom);
  }

  #fill(y: number, from: number, to: number): void {
    const line = this.#lines[y];
    if (!line) return;
    const cell = blankFor(this.#attrs);
    for (let x = Math.max(0, from); x < Math.min(this.cols, to); x++) line[x] = cell;
    // Do not leave half of a wide character behind at either edge.
    if (from > 0 && line[from - 1]?.w === 2) line[from - 1] = cell;
    if (to < this.cols && line[to]?.w === 0) line[to] = cell;
    this.#touch(y);
  }

  #eraseDisplay(mode: number): void {
    if (mode === 0) {
      this.#fill(this.y, this.x, this.cols);
      for (let y = this.y + 1; y < this.rows; y++) this.#fill(y, 0, this.cols);
    } else if (mode === 1) {
      for (let y = 0; y < this.y; y++) this.#fill(y, 0, this.cols);
      this.#fill(this.y, 0, this.x + 1);
    } else if (mode === 2 || mode === 3) {
      for (let y = 0; y < this.rows; y++) this.#fill(y, 0, this.cols);
    }
  }

  #eraseLine(mode: number): void {
    if (mode === 0) this.#fill(this.y, this.x, this.cols);
    else if (mode === 1) this.#fill(this.y, 0, this.x + 1);
    else if (mode === 2) this.#fill(this.y, 0, this.cols);
  }

  #deleteChars(n: number): void {
    const line = this.#line(this.y);
    const count = Math.min(n, this.cols - this.x);
    line.splice(this.x, count);
    line.push(...blankRow(count, blankFor(this.#attrs)));
    this.#touch(this.y);
  }

  #insertChars(n: number): void {
    const line = this.#line(this.y);
    const count = Math.min(n, this.cols - this.x);
    line.splice(this.x, 0, ...blankRow(count, blankFor(this.#attrs)));
    line.length = this.cols;
    this.#touch(this.y);
  }

  #privateMode(params: string, on: boolean): void {
    for (const [mode] of parseParams(params)) {
      if (mode === 25) this.cursorVisible = on;
      else if (mode === 7) this.#autowrap = on;
      else if (mode === 47 || mode === 1047 || mode === 1049) this.#alternate(on, mode === 1049);
      // Mouse, bracketed paste, application keypad and the rest are ignored.
    }
  }

  #alternate(on: boolean, withCursor: boolean): void {
    if (on === (this.#mainLines !== null)) return;
    if (on) {
      this.usedAlternate = true;
      this.#mainLines = this.#lines;
      this.#mainCursor = withCursor ? { x: this.x, y: this.y, attrs: this.#attrs } : null;
      this.#lines = Array.from({ length: this.rows }, () => blankRow(this.cols));
    } else {
      this.#lines = this.#mainLines ?? this.#lines;
      this.#mainLines = null;
      if (this.#mainCursor) {
        this.x = this.#mainCursor.x;
        this.y = this.#mainCursor.y;
        this.#attrs = this.#mainCursor.attrs;
      }
      this.#mainCursor = null;
    }
    this.#top = 0;
    this.#bottom = this.rows - 1;
    this.#wrapPending = false;
    this.#touchAll();
  }

  #save(): void {
    this.#saved = { x: this.x, y: this.y, attrs: this.#attrs };
  }

  #restore(): void {
    const s = this.#saved;
    if (!s) {
      this.x = 0;
      this.y = 0;
      return;
    }
    this.x = clampInt(s.x, 0, this.cols - 1);
    this.y = clampInt(s.y, 0, this.rows - 1);
    this.#attrs = s.attrs;
  }

  #fullReset(): void {
    this.#lines = Array.from({ length: this.rows }, () => blankRow(this.cols));
    this.#mainLines = null;
    this.#mainCursor = null;
    this.#attrs = PLAIN;
    this.#top = 0;
    this.#bottom = this.rows - 1;
    this.#saved = null;
    this.#autowrap = true;
    this.cursorVisible = true;
    this.x = 0;
    this.y = 0;
    this.#parser.reset();
    this.#touchAll();
  }
}
