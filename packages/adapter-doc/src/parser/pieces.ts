import { corrupt, DocError } from "../errors";
import { FcLcb, type Fib } from "./fib";
import { readPlc } from "./plc";
import { type ByteReader, CP1252, UTF16 } from "./reader";

/** Hard cap on document characters (all stories), to bound memory on hostile input. */
export const MAX_CHARS = 8_000_000;

/** One entry of the piece table: CPs [cpStart, cpEnd) live at byte offset `fc` of the WordDocument stream. */
export interface Piece {
  cpStart: number;
  cpEnd: number;
  /** Byte offset of the first character. */
  fc: number;
  /** 1 byte per character (code page 1252) instead of UTF-16LE. */
  compressed: boolean;
  /** Property modifier: index into `PieceTable.prcs` when bit 0 is set (Prm1), else unused (Prm0). */
  prm: number;
}

export interface PieceTable {
  pieces: Piece[];
  /** grpprls of the Prc entries that precede the piece table in the CLX (fast-save modifications). */
  prcs: Uint8Array[];
  /** The text of every story, in CP order. */
  text: string;
}

/** Byte offset of `cp` and its width, or null when the CP is not covered by any piece. */
export function fcOfCp(table: PieceTable, cp: number): { fc: number; width: 1 | 2; piece: Piece } | null {
  const piece = pieceAt(table.pieces, cp);
  if (!piece) return null;
  const width = piece.compressed ? 1 : 2;
  return { fc: piece.fc + (cp - piece.cpStart) * width, width, piece };
}

export function pieceAt(pieces: readonly Piece[], cp: number): Piece | null {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pieces[mid];
    if (cp < p.cpStart) hi = mid - 1;
    else if (cp >= p.cpEnd) lo = mid + 1;
    else return p;
  }
  return null;
}

/** Reads the CLX (MS-DOC 2.9.38): Prc entries, then the Pcdt holding the piece table, and decodes all text. */
export function readPieceTable(word: ByteReader, table: ByteReader, fib: Fib): PieceTable {
  const { fc, lcb } = fib.fcLcb(FcLcb.clx);
  if (lcb === 0) throw corrupt("the document has no piece table");
  table.check(fc, lcb, "CLX");
  const end = fc + lcb;
  const prcs: Uint8Array[] = [];
  let at = fc;
  while (at < end) {
    const type = table.u8(at);
    if (type === 0x01) {
      const cb = table.i16(at + 1);
      if (cb < 0) throw corrupt("negative Prc size");
      prcs.push(table.slice(at + 3, cb, "Prc"));
      at += 3 + cb;
    } else if (type === 0x02) {
      const size = table.u32(at + 1);
      return decodePieces(word, table, at + 5, size, prcs);
    } else {
      throw corrupt(`unknown CLX entry 0x${type.toString(16)}`);
    }
  }
  throw corrupt("the CLX has no piece table");
}

function decodePieces(
  word: ByteReader,
  table: ByteReader,
  offset: number,
  size: number,
  prcs: Uint8Array[],
): PieceTable {
  const plc = readPlc(table, offset, size, 8, "piece table");
  if (plc.pos[0] !== 0) throw corrupt("the piece table does not start at CP 0");
  if (plc.pos[plc.count] > MAX_CHARS) throw new DocError("too-large", `${plc.pos[plc.count]} characters`);
  const pieces: Piece[] = [];
  const chunks: string[] = [];
  for (let i = 0; i < plc.count; i++) {
    const cpStart = plc.pos[i];
    const cpEnd = plc.pos[i + 1];
    const pcd = plc.dataOffset + i * 8;
    const raw = table.u32(pcd + 2);
    const compressed = (raw & 0x40000000) !== 0;
    const fcRaw = raw & 0x3fffffff;
    const fc = compressed ? fcRaw / 2 : fcRaw;
    const chars = cpEnd - cpStart;
    if (!Number.isInteger(fc)) throw corrupt("misaligned compressed piece");
    const bytes = word.slice(fc, compressed ? chars : chars * 2, "piece text");
    chunks.push((compressed ? CP1252 : UTF16).decode(bytes));
    pieces.push({ cpStart, cpEnd, fc, compressed, prm: table.u16(pcd + 6) });
  }
  return { pieces, prcs, text: chunks.join("") };
}

/** The Prm1 grpprl of a piece, if its property modifier points into the CLX Prc list. */
export function pieceGrpprl(table: PieceTable, piece: Piece): Uint8Array | null {
  if ((piece.prm & 1) === 0) return null;
  return table.prcs[piece.prm >> 1] ?? null;
}
