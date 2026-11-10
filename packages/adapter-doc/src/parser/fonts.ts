import { FcLcb, type Fib } from "./fib";
import type { ByteReader } from "./reader";

export type GenericFamily = "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy";

export interface FontInfo {
  name: string;
  /** Generic family from the FFN's `ff` bits, when the file states one. */
  generic: GenericFamily | null;
}

const FF: (GenericFamily | null)[] = [null, "serif", "sans-serif", "monospace", "cursive", "fantasy"];
/** Offset of xszFfn inside an FFN: ffid, wWeight, chs, ixchSzAlt, panose[10], fs[24]. */
const FFN_NAME = 39;

/** Reads the font table (SttbfFfn). Unreadable entries become empty names. */
export function readFonts(table: ByteReader, fib: Fib): FontInfo[] {
  const { fc, lcb } = fib.fcLcb(FcLcb.sttbfFfn);
  if (lcb < 4) return [];
  table.check(fc, lcb, "font table");
  const end = fc + lcb;
  const count = table.u16(fc);
  // fExtend (0xFFFF) is not used by SttbfFfn; treat it as a damaged table.
  if (count === 0xffff) return [];
  const fonts: FontInfo[] = [];
  let at = fc + 4;
  for (let i = 0; i < count && at < end; i++) {
    const size = table.u8(at);
    const ffn = at + 1;
    at = ffn + size;
    if (at > end || size <= FFN_NAME) {
      fonts.push({ name: "", generic: null });
      continue;
    }
    const maxChars = Math.floor((size - FFN_NAME) / 2);
    let name = table.utf16(ffn + FFN_NAME, maxChars);
    const nul = name.indexOf("\u0000");
    if (nul >= 0) name = name.slice(0, nul);
    fonts.push({ name: name.trim(), generic: FF[(table.u8(ffn) >> 4) & 7] ?? null });
  }
  return fonts;
}
