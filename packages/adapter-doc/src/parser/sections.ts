import { FcLcb, type Fib } from "./fib";
import { readPlc } from "./plc";
import type { ByteReader } from "./reader";
import { argI16, argU8, argU16, parseGrpprl } from "./sprm";

/** Page geometry and break behaviour of one section. Lengths in twips. */
export interface SectionProps {
  /** First CP (main story) of the section; the section ends where the next one starts. */
  cpStart: number;
  cpEnd: number;
  /** 0 continuous, 1 new column, 2 new page, 3 even page, 4 odd page. */
  breakCode: number;
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  headerTop: number;
  footerBottom: number;
  /** The first page uses the "first page" header and footer. */
  titlePage: boolean;
}

/** Word's built-in SEP defaults (US Letter, 1.25" side and 1" top/bottom margins). */
function defaultSection(cpStart: number, cpEnd: number): SectionProps {
  return {
    cpStart,
    cpEnd,
    breakCode: 2,
    pageWidth: 12240,
    pageHeight: 15840,
    marginLeft: 1800,
    marginRight: 1800,
    marginTop: 1440,
    marginBottom: 1440,
    headerTop: 720,
    footerBottom: 720,
    titlePage: false,
  };
}

const MIN_PAGE = 1440;
const MAX_PAGE = 31680;

/** Reads PlcfSed and each section's SEPX. Missing tables yield one default section over the main story. */
export function readSections(word: ByteReader, table: ByteReader, fib: Fib): SectionProps[] {
  const { fc, lcb } = fib.fcLcb(FcLcb.plcfSed);
  const mainEnd = fib.stories.main;
  if (lcb === 0) return [defaultSection(0, mainEnd)];
  const plc = readPlc(table, fc, lcb, 12, "section table");
  const sections: SectionProps[] = [];
  for (let i = 0; i < plc.count; i++) {
    const section = defaultSection(plc.pos[i], Math.min(plc.pos[i + 1], mainEnd));
    const fcSepx = table.u32(plc.dataOffset + i * 12 + 2);
    if (fcSepx !== 0xffffffff && word.has(fcSepx, 2)) {
      const cb = word.u16(fcSepx);
      if (word.has(fcSepx + 2, cb)) applySepx(section, word.slice(fcSepx + 2, cb, "SEPX"));
    }
    sanitizeGeometry(section);
    if (section.cpEnd > section.cpStart) sections.push(section);
  }
  return sections.length > 0 ? sections : [defaultSection(0, mainEnd)];
}

function applySepx(section: SectionProps, grpprl: Uint8Array): void {
  for (const s of parseGrpprl(grpprl)) {
    switch (s.op) {
      case 0x3009:
        section.breakCode = argU8(s);
        break;
      case 0x300a:
        section.titlePage = argU8(s) !== 0;
        break;
      case 0xb01f:
        section.pageWidth = argU16(s);
        break;
      case 0xb020:
        section.pageHeight = argU16(s);
        break;
      case 0xb021:
        section.marginLeft = argU16(s);
        break;
      case 0xb022:
        section.marginRight = argU16(s);
        break;
      case 0x9023:
        // Negative top/bottom margins mean "exactly"; the magnitude is the margin.
        section.marginTop = Math.abs(argI16(s));
        break;
      case 0x9024:
        section.marginBottom = Math.abs(argI16(s));
        break;
      case 0xb017:
        section.headerTop = argU16(s);
        break;
      case 0xb018:
        section.footerBottom = argU16(s);
        break;
    }
  }
}

/** Clamps nonsense geometry so a damaged SEPX cannot produce a zero-width or kilometre-high page. */
function sanitizeGeometry(s: SectionProps): void {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  s.pageWidth = clamp(s.pageWidth, MIN_PAGE, MAX_PAGE);
  s.pageHeight = clamp(s.pageHeight, MIN_PAGE, MAX_PAGE);
  const maxSide = s.pageWidth / 2 - 360;
  s.marginLeft = clamp(s.marginLeft, 0, maxSide);
  s.marginRight = clamp(s.marginRight, 0, maxSide);
  const maxTop = s.pageHeight / 2 - 360;
  s.marginTop = clamp(s.marginTop, 0, maxTop);
  s.marginBottom = clamp(s.marginBottom, 0, maxTop);
  s.headerTop = clamp(s.headerTop, 0, s.marginTop);
  s.footerBottom = clamp(s.footerBottom, 0, s.marginBottom);
}
