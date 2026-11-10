import { corrupt, DocError } from "../errors";
import type { ByteReader } from "./reader";

const W_IDENT = 0xa5ec;
/** Word 97 writes nFib 0xC1; earlier revisions (Word 6 = 0x65, Word 95 = 0x68) use another FIB layout. */
const MIN_NFIB = 0xc0;
const CSW_97 = 0x0e;
const CSLW_97 = 0x16;
/** Offset of `fibRgFcLcbBlob` when csw and cslw have their Word 97 sizes. */
const FC_LCB_OFFSET = 0x9a;

/** Indexes into FibRgFcLcb97 (MS-DOC 2.5.6): each entry is an (fc, lcb) pair in the table stream. */
export const FcLcb = {
  stshf: 1,
  plcffndRef: 2,
  plcffndTxt: 3,
  plcfSed: 6,
  plcfHdd: 11,
  plcfBteChpx: 12,
  plcfBtePapx: 13,
  sttbfFfn: 15,
  clx: 33,
  plcfendRef: 46,
  plcfendTxt: 47,
  plfLst: 73,
  plfLfo: 74,
} as const;

/** Character counts of the stories, in CP order (MS-DOC 2.5.4). */
export interface StoryLengths {
  main: number;
  footnotes: number;
  headers: number;
  macros: number;
  comments: number;
  endnotes: number;
  textboxes: number;
  headerTextboxes: number;
}

export interface Fib {
  nFib: number;
  /** Which table stream holds the formatting tables. */
  table: 0 | 1;
  /** The last save was an incremental ("fast") save. */
  complex: boolean;
  stories: StoryLengths;
  /** (fc, lcb) of a FibRgFcLcb entry; lcb 0 means "absent". */
  fcLcb(index: number): { fc: number; lcb: number };
}

/** Parses and validates the File Information Block at the start of the WordDocument stream. */
export function readFib(word: ByteReader): Fib {
  if (word.length < FC_LCB_OFFSET + 8 * (FcLcb.clx + 1)) throw corrupt("the WordDocument stream is too short");
  if (word.u16(0) !== W_IDENT) throw new DocError("not-word", "missing Word signature");
  const nFib = word.u16(2);
  if (nFib < MIN_NFIB) throw new DocError("unsupported-version", `file format revision ${nFib}`);
  const flags = word.u16(0x0a);
  if (flags & 0x0100 || flags & 0x8000) throw new DocError("encrypted");

  const csw = word.u16(0x20);
  const cslwOffset = 0x22 + csw * 2;
  const cslw = word.u16(cslwOffset);
  if (csw !== CSW_97 || cslw !== CSLW_97) throw corrupt(`unexpected FIB section sizes (csw ${csw}, cslw ${cslw})`);
  const lw = cslwOffset + 2;
  const cbRgFcLcbOffset = lw + cslw * 4;
  const fcLcbCount = word.u16(cbRgFcLcbOffset);
  const blob = cbRgFcLcbOffset + 2;
  if (fcLcbCount <= FcLcb.clx) throw corrupt(`FIB has only ${fcLcbCount} table entries`);

  // fibRgLw97: cbMac, 2 reserved, then the story lengths.
  const ccp = (i: number) => {
    const value = word.i32(lw + i * 4);
    if (value < 0) throw corrupt("negative story length");
    return value;
  };
  const stories: StoryLengths = {
    main: ccp(3),
    footnotes: ccp(4),
    headers: ccp(5),
    macros: ccp(6),
    comments: ccp(7),
    endnotes: ccp(8),
    textboxes: ccp(9),
    headerTextboxes: ccp(10),
  };

  return {
    nFib,
    table: flags & 0x0200 ? 1 : 0,
    complex: (flags & 0x0004) !== 0,
    stories,
    fcLcb(index) {
      if (index >= fcLcbCount) return { fc: 0, lcb: 0 };
      return { fc: word.u32(blob + index * 8), lcb: word.u32(blob + index * 8 + 4) };
    },
  };
}
