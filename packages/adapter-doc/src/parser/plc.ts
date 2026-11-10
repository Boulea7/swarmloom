import { corrupt } from "../errors";
import type { ByteReader } from "./reader";

/** A PLC: n+1 ascending positions (CPs or FCs) followed by n fixed-size data elements (MS-DOC 2.2.2). */
export interface Plc {
  /** n+1 positions. */
  pos: number[];
  /** Byte offset of data element i is `dataOffset + i * dataSize`. */
  dataOffset: number;
  dataSize: number;
  count: number;
}

/**
 * Reads a PLC located at [offset, offset + size) of `table`.
 * `strict` rejects non-monotonic positions (piece tables); other PLCs only need them non-decreasing.
 */
export function readPlc(table: ByteReader, offset: number, size: number, dataSize: number, what: string): Plc {
  table.check(offset, size, what);
  if (size < 4 || (size - 4) % (4 + dataSize) !== 0) {
    throw corrupt(`${what} has an invalid size ${size} for ${dataSize}-byte elements`);
  }
  const count = (size - 4) / (4 + dataSize);
  const pos: number[] = new Array(count + 1);
  for (let i = 0; i <= count; i++) {
    pos[i] = table.u32(offset + i * 4);
    if (i > 0 && pos[i]! < pos[i - 1]!) throw corrupt(`${what} positions are not ascending`);
  }
  return { pos, dataOffset: offset + (count + 1) * 4, dataSize, count };
}
