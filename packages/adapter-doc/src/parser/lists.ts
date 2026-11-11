import { chineseCounting, roman, wordLetters } from "@swarmloom/adapter-docx/paged";
import { FcLcb, type Fib } from "./fib";
import type { ByteReader } from "./reader";

/** One level of a list definition (LVL, MS-DOC 2.9.150). */
export interface ListLevel {
  start: number;
  /** Number format code (nfc): 0 decimal, 1/2 upper/lower roman, 3/4 upper/lower letter, 23 bullet, 255 none. */
  format: number;
  /** Level text; characters 0..8 are placeholders for the numbers of those levels. */
  text: string;
  /** What follows the number: 0 tab, 1 space, 2 nothing. */
  follow: number;
  /** Paragraph sprms of the level (indents). */
  papx: Uint8Array;
}

interface ListDef {
  id: number;
  levels: ListLevel[];
}

/** Resolves a paragraph's (ilfo, ilvl) to a level and computes running numbers. */
export interface Lists {
  level(ilfo: number, ilvl: number): ListLevel | null;
  /**
   * Advances the counter of (ilfo's list, ilvl) and returns the marker text, e.g. "2.1." or a bullet.
   * Bullets may be symbol-font private-use characters; map them before display.
   */
  next(ilfo: number, ilvl: number): string | null;
}

const LSTF_SIZE = 28;
const LVLF_SIZE = 28;
const LFO_SIZE = 16;
const MAX_LISTS = 4096;

/** Reads PlfLst (with its trailing LVL array) and PlfLfo. Returns null when the document has no lists. */
export function readLists(table: ByteReader, fib: Fib): Lists | null {
  const lst = fib.fcLcb(FcLcb.plfLst);
  const lfo = fib.fcLcb(FcLcb.plfLfo);
  if (lst.lcb < 2 || lfo.lcb < 4) return null;
  const count = table.i16(lst.fc);
  if (count <= 0 || count > MAX_LISTS) return null;
  const defs: ListDef[] = [];
  // The LVL array follows the LSTFs and is not counted in lcbPlfLst.
  let at = lst.fc + 2 + count * LSTF_SIZE;
  for (let i = 0; i < count; i++) {
    const lstf = lst.fc + 2 + i * LSTF_SIZE;
    const simple = (table.u8(lstf + 26) & 1) !== 0;
    const levels: ListLevel[] = [];
    for (let l = 0; l < (simple ? 1 : 9); l++) {
      const read = readLevel(table, at);
      levels.push(read.level);
      at = read.next;
    }
    defs.push({ id: table.i32(lstf), levels });
  }
  const byId = new Map(defs.map((d) => [d.id, d]));

  const overrides = table.i32(lfo.fc);
  if (overrides < 0 || overrides > MAX_LISTS) return null;
  const lfoIds: number[] = [];
  for (let i = 0; i < overrides; i++) lfoIds.push(table.i32(lfo.fc + 4 + i * LFO_SIZE));

  const counters = new Map<number, number[]>();
  const defOf = (ilfo: number) => byId.get(lfoIds[ilfo - 1] ?? Number.NaN) ?? null;
  const level = (ilfo: number, ilvl: number) => {
    const def = defOf(ilfo);
    return def ? (def.levels[Math.min(ilvl, def.levels.length - 1)] ?? null) : null;
  };

  return {
    level,
    next(ilfo, ilvl) {
      const def = defOf(ilfo);
      const lvl = level(ilfo, ilvl);
      if (!def || !lvl) return null;
      let values = counters.get(def.id);
      if (!values) {
        values = def.levels.map((l) => l.start - 1);
        counters.set(def.id, values);
      }
      values[ilvl] = (values[ilvl] ?? lvl.start - 1) + 1;
      for (let deeper = ilvl + 1; deeper < values.length; deeper++)
        values[deeper] = (def.levels[deeper]?.start ?? 1) - 1;
      return renderMarker(def, lvl, values);
    },
  };
}

function readLevel(table: ByteReader, at: number): { level: ListLevel; next: number } {
  table.check(at, LVLF_SIZE, "list level");
  const start = table.i32(at);
  const format = table.u8(at + 4);
  const follow = table.u8(at + 15);
  const cbChpx = table.u8(at + 24);
  const cbPapx = table.u8(at + 25);
  let p = at + LVLF_SIZE;
  const papx = table.slice(p, cbPapx, "list level PAPX");
  p += cbPapx + cbChpx;
  const cch = table.u16(p);
  const text = table.utf16(p + 2, cch);
  return { level: { start, format, text, follow, papx }, next: p + 2 + cch * 2 };
}

function renderMarker(def: ListDef, lvl: ListLevel, values: number[]): string {
  if (lvl.format === 255) return "";
  let out = "";
  for (const ch of lvl.text) {
    const code = ch.charCodeAt(0);
    if (code <= 8) {
      const level = def.levels[code];
      out += formatNumber(values[code] ?? 1, level?.format ?? 0);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Formats a list number for the common nfc codes; unknown codes fall back to decimal. */
export function formatNumber(n: number, nfc: number): string {
  switch (nfc) {
    case 1:
      return roman(n).toUpperCase();
    case 2:
      return roman(n);
    case 3:
      return wordLetters(n).toUpperCase();
    case 4:
      return wordLetters(n);
    case 22:
      return n < 10 ? `0${n}` : String(n);
    case 23:
      return "•";
    case 10:
    case 11:
    case 33:
    case 35:
    case 38:
      return chineseCounting(n);
    case 255:
      return "";
    default:
      return String(n);
  }
}
