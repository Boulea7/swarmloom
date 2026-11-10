/** A single property modifier: `op` is the 16-bit sprm, `arg` its operand bytes (without any size prefix). */
export interface Sprm {
  op: number;
  arg: Uint8Array;
}

const SPRM_T_DEF_TABLE = 0xd608;
const SPRM_P_CHG_TABS = 0xc615;

/** Fixed operand sizes by spra (MS-DOC 2.2.5.1); spra 6 is variable-length. */
const FIXED_SIZE = [1, 1, 2, 4, 2, 2, -1, 3] as const;

/**
 * Splits a grpprl into sprms. Stops quietly at a truncated trailing sprm: Word itself
 * tolerates padding bytes at the end of property runs.
 */
export function parseGrpprl(grpprl: Uint8Array): Sprm[] {
  const out: Sprm[] = [];
  let at = 0;
  while (at + 2 <= grpprl.length) {
    const op = grpprl[at]! | (grpprl[at + 1]! << 8);
    at += 2;
    const fixed = FIXED_SIZE[(op >> 13) & 7]!;
    let start = at;
    let size: number;
    if (fixed >= 0) {
      size = fixed;
    } else if (op === SPRM_T_DEF_TABLE) {
      if (at + 2 > grpprl.length) break;
      // cb counts the rest of the operand plus one.
      size = (grpprl[at]! | (grpprl[at + 1]! << 8)) - 1;
      start = at + 2;
    } else if (op === SPRM_P_CHG_TABS && grpprl[at] === 0xff) {
      size = chgTabsSize(grpprl, at + 1);
      start = at + 1;
    } else {
      if (at + 1 > grpprl.length) break;
      size = grpprl[at]!;
      start = at + 1;
    }
    if (size < 0 || start + size > grpprl.length) break;
    out.push({ op, arg: grpprl.subarray(start, start + size) });
    at = start + size;
  }
  return out;
}

/** Size of a PChgTabsOperand whose cb is 255: a deletion list of 4-byte entries, then an addition list of 3-byte ones. */
function chgTabsSize(grpprl: Uint8Array, at: number): number {
  const deleted = grpprl[at] ?? 0;
  const addAt = at + 1 + deleted * 4;
  const added = grpprl[addAt] ?? 0;
  return 1 + deleted * 4 + 1 + added * 3;
}

export function argU8(s: Sprm, offset = 0): number {
  return s.arg[offset] ?? 0;
}

export function argU16(s: Sprm, offset = 0): number {
  return (s.arg[offset] ?? 0) | ((s.arg[offset + 1] ?? 0) << 8);
}

export function argI16(s: Sprm, offset = 0): number {
  const v = argU16(s, offset);
  return v & 0x8000 ? v - 0x10000 : v;
}

export function argI32(s: Sprm, offset = 0): number {
  return argU16(s, offset) | (argU16(s, offset + 2) << 16);
}
