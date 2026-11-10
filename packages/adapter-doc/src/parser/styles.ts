import type { Fib } from "./fib";
import { FcLcb } from "./fib";
import {
  applyCharSprm,
  applyParaSprm,
  type CharProps,
  defaultCharProps,
  defaultParaProps,
  type ParaProps,
} from "./props";
import type { ByteReader } from "./reader";
import { parseGrpprl } from "./sprm";

const NO_BASE = 0x0fff;
/** Built-in style identifiers (sti) the converter cares about. */
export const Sti = { normal: 0, heading1: 1, heading9: 9, title: 62, subtitle: 74 } as const;

/** One style after inheritance through `istdBase` has been applied. */
export interface Style {
  istd: number;
  /** Built-in style identifier; 0x0FFE for user-defined styles. */
  sti: number;
  name: string;
  kind: "paragraph" | "character" | "table" | "list";
  para: ParaProps;
  char: CharProps;
  /** Character grpprls from the root of the chain down to this style (applied for character styles). */
  charChain: Uint8Array[];
}

export interface StyleSheet {
  /** Style for `istd`, falling back to Normal (istd 0) or defaults. */
  get(istd: number): Style;
}

interface RawStyle {
  sti: number;
  kind: Style["kind"];
  base: number;
  name: string;
  papx: Uint8Array | null;
  chpx: Uint8Array | null;
}

const KINDS: Style["kind"][] = ["paragraph", "paragraph", "character", "table", "list"];

/** A style sheet with only Word's defaults, used when the STSH is unreadable. */
export function emptyStyles(): StyleSheet {
  return resolver([], defaultCharProps());
}

/** Reads the STSH (MS-DOC 2.9.271) and resolves inheritance lazily. */
export function readStyles(table: ByteReader, fib: Fib): StyleSheet {
  const { fc, lcb } = fib.fcLcb(FcLcb.stshf);
  const raw: (RawStyle | null)[] = [];
  const defaults = defaultCharProps();
  if (lcb >= 2 + 18) {
    table.check(fc, lcb, "style sheet");
    const cbStshi = table.u16(fc);
    const stshi = fc + 2;
    const cstd = table.u16(stshi);
    const cbBase = table.u16(stshi + 2);
    defaults.font = table.u16(stshi + 12);
    defaults.fontEastAsia = table.u16(stshi + 14);
    const end = fc + lcb;
    let at = stshi + cbStshi;
    for (let istd = 0; istd < cstd && at + 2 <= end; istd++) {
      const cbStd = table.u16(at);
      at += 2;
      raw.push(cbStd > 0 && at + cbStd <= end ? readStd(table, at, cbStd, cbBase) : null);
      at += cbStd;
    }
  }
  return resolver(raw, defaults);
}

function readStd(table: ByteReader, at: number, size: number, cbBase: number): RawStyle | null {
  if (size < cbBase + 2) return null;
  const sti = table.u16(at) & 0x0fff;
  const stkBase = table.u16(at + 2);
  const kind = KINDS[stkBase & 0x0f] ?? "paragraph";
  const base = stkBase >> 4;
  const cupx = table.u16(at + 4) & 0x0f;
  const end = at + size;
  let p = at + cbBase;
  const cch = table.u16(p);
  if (p + 2 + cch * 2 > end) return null;
  const name = table.utf16(p + 2, cch);
  p += 2 + cch * 2 + 2;
  const upx: Uint8Array[] = [];
  for (let i = 0; i < cupx && p + 2 <= end; i++) {
    const cb = table.u16(p);
    if (p + 2 + cb > end) break;
    upx.push(table.slice(p + 2, cb, "UPX"));
    p += 2 + cb + (cb & 1);
  }
  let papx: Uint8Array | null = null;
  let chpx: Uint8Array | null = null;
  if (kind === "paragraph") {
    // UpxPapx starts with the istd it belongs to.
    papx = upx[0] && upx[0].length >= 2 ? upx[0].subarray(2) : null;
    chpx = upx[1] ?? null;
  } else if (kind === "character") {
    chpx = upx[0] ?? null;
  }
  return { sti, kind, base, name, papx, chpx };
}

function resolver(raw: (RawStyle | null)[], defaults: CharProps): StyleSheet {
  const cache = new Map<number, Style>();
  const fallback: Style = {
    istd: 0,
    sti: Sti.normal,
    name: "Normal",
    kind: "paragraph",
    para: defaultParaProps(),
    char: defaults,
    charChain: [],
  };

  const resolve = (istd: number, depth: number): Style => {
    const hit = cache.get(istd);
    if (hit) return hit;
    const r = raw[istd];
    if (!r) return istd !== 0 && raw[0] ? resolve(0, depth + 1) : fallback;
    // Guard against inheritance cycles in damaged files.
    const base = r.base !== NO_BASE && r.base !== istd && depth < 16 ? resolve(r.base, depth + 1) : fallback;
    const para = { ...base.para };
    const char = { ...base.char };
    if (r.papx) for (const s of parseGrpprl(r.papx)) applyParaSprm(para, s);
    if (r.chpx) for (const s of parseGrpprl(r.chpx)) applyCharSprm(char, s, base.char);
    const style: Style = {
      istd,
      sti: r.sti,
      name: r.name,
      kind: r.kind,
      para,
      char,
      charChain: r.chpx ? [...base.charChain, r.chpx] : base.charChain,
    };
    cache.set(istd, style);
    return style;
  };

  return {
    get(istd) {
      return resolve(istd, 0);
    },
  };
}
