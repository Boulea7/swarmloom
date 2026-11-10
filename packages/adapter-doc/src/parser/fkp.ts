import { corrupt } from "../errors";
import type { Fib } from "./fib";
import { readPlc } from "./plc";
import type { ByteReader } from "./reader";

const PAGE = 512;
/** Upper bound on FKP pages followed per bin table; real documents stay far below. */
const MAX_PAGES = 65_536;
const EMPTY: Uint8Array = new Uint8Array(0);

/** Formatting of the bytes [fcStart, fcEnd) of the WordDocument stream. */
export interface FkpRun {
  fcStart: number;
  fcEnd: number;
  /** Paragraph style index (PAPX runs only; 0 for CHPX runs). */
  istd: number;
  grpprl: Uint8Array;
}

/** Reads a bin table (PlcfBteChpx/PlcfBtePapx) and every FKP page it points to, sorted by FC. */
export function readFkpRuns(
  word: ByteReader,
  table: ByteReader,
  fib: Fib,
  index: number,
  kind: "chpx" | "papx",
): FkpRun[] {
  const { fc, lcb } = fib.fcLcb(index);
  if (lcb === 0) return [];
  const plc = readPlc(table, fc, lcb, 4, `${kind} bin table`);
  if (plc.count > MAX_PAGES) throw corrupt(`too many ${kind} pages`);
  const runs: FkpRun[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < plc.count; i++) {
    const pn = table.u32(plc.dataOffset + i * 4) & 0x3fffff;
    if (seen.has(pn)) continue;
    seen.add(pn);
    if (kind === "chpx") readChpxPage(word, pn * PAGE, runs);
    else readPapxPage(word, pn * PAGE, runs);
  }
  runs.sort((a, b) => a.fcStart - b.fcStart);
  return runs;
}

function pageRuns(word: ByteReader, page: number): { crun: number; fcs: number[] } {
  word.check(page, PAGE, "FKP page");
  const crun = word.u8(page + PAGE - 1);
  const fcs: number[] = [];
  for (let i = 0; i <= crun; i++) fcs.push(word.u32(page + i * 4));
  return { crun, fcs };
}

/** ChpxFkp: rgfc[crun + 1], rgb[crun] word offsets, each pointing at a Chpx (cb, grpprl). */
function readChpxPage(word: ByteReader, page: number, out: FkpRun[]): void {
  const { crun, fcs } = pageRuns(word, page);
  const rgb = page + (crun + 1) * 4;
  for (let i = 0; i < crun; i++) {
    const offset = word.u8(rgb + i) * 2;
    let grpprl = EMPTY;
    if (offset !== 0) {
      const cb = word.u8(page + offset);
      if (offset + 1 + cb > PAGE - 1) throw corrupt("CHPX overflows its page");
      grpprl = word.slice(page + offset + 1, cb, "CHPX");
    }
    out.push({ fcStart: fcs[i]!, fcEnd: fcs[i + 1]!, istd: 0, grpprl });
  }
}

/** PapxFkp: rgfc[crun + 1], 13-byte BxPap entries; each points at a PapxInFkp (cb, istd, grpprl). */
function readPapxPage(word: ByteReader, page: number, out: FkpRun[]): void {
  const { crun, fcs } = pageRuns(word, page);
  const rgbx = page + (crun + 1) * 4;
  for (let i = 0; i < crun; i++) {
    const offset = word.u8(rgbx + i * 13) * 2;
    let istd = 0;
    let grpprl = EMPTY;
    if (offset !== 0) {
      let at = page + offset;
      let size = word.u8(at) * 2 - 1;
      at += 1;
      if (size < 0) {
        size = word.u8(at) * 2;
        at += 1;
      }
      if (at + size > page + PAGE - 1) throw corrupt("PAPX overflows its page");
      if (size >= 2) {
        istd = word.u16(at);
        grpprl = word.slice(at + 2, size - 2, "PAPX");
      }
    }
    out.push({ fcStart: fcs[i]!, fcEnd: fcs[i + 1]!, istd, grpprl });
  }
}

/** Index of the first run that ends after `fc` (it may start after `fc`), or runs.length. Runs are sorted. */
export function runAtOrAfter(runs: readonly FkpRun[], fc: number): number {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid]!.fcEnd <= fc) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The run containing `fc`, or null. */
export function runAt(runs: readonly FkpRun[], fc: number): FkpRun | null {
  const run = runs[runAtOrAfter(runs, fc)];
  return run && run.fcStart <= fc ? run : null;
}
