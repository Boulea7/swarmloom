import { hasBytes, u16, u32, utf16le } from "./bytes";

/** What format detection needs from a Compound File Binary (OLE2) container. */
export interface CfbInfo {
  /** Directory entry names (streams and storages), e.g. "WordDocument", "Workbook". */
  names: string[];
  /**
   * True for password-protected documents: an encrypted OOXML package (EncryptionInfo +
   * EncryptedPackage streams), an encrypted PowerPoint (EncryptedSummary) or a Word 97-2003
   * file whose FIB has fEncrypted set.
   */
  encrypted: boolean;
}

/** First 8 bytes of every Compound File Binary (legacy Office) file. */
export const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/** Sector ids at or above this value are markers (free, end of chain, FAT, DIFAT). */
const MAX_REGULAR_SECTOR = 0xfffffffa;
const FREE_SECTOR = 0xffffffff;
const MAX_CHAIN = 1024;
const MAX_FAT_SECTORS = 1 << 16;
const ENTRY_SIZE = 128;
/** The name-scan fallback only looks at the head, where small directories live. */
const SCAN_LIMIT = 1 << 21;
const WORD_IDENT = 0xa5ec;
const WORD_ENCRYPTED = 0x0100;
const ENCRYPTION_STREAMS = ["EncryptionInfo", "EncryptedPackage", "EncryptedSummary"];
/** Names looked for when the directory cannot be walked (truncated or damaged file). */
const KNOWN_STREAMS = ["WordDocument", "Workbook", "Book", "PowerPoint Document", ...ENCRYPTION_STREAMS];

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

/**
 * Lists the directory of a CFB file (legacy .doc/.xls/.ppt, encrypted OOXML) without reading streams.
 *
 * Walks the FAT chain of the directory with every offset bounds-checked and every chain length
 * capped, so hostile files cannot loop or read out of range. When the directory cannot be walked,
 * falls back to scanning for well-known UTF-16 stream names.
 *
 * @param bytes The whole file (or its head).
 * @returns Entry names and the encryption flag, or `null` when `bytes` is not a CFB file.
 */
export function readCfb(bytes: Uint8Array): CfbInfo | null {
  if (!hasBytes(bytes, CFB_MAGIC)) return null;
  return readDirectory(bytes) ?? scanNames(bytes);
}

function readDirectory(bytes: Uint8Array): CfbInfo | null {
  if (u16(bytes, 0x1c) !== 0xfffe) return null;
  const shift = u16(bytes, 0x1e);
  if (shift !== 9 && shift !== 12) return null;
  const sectorSize = 1 << shift;
  const perSector = sectorSize / 4;
  const offsetOf = (sector: number): number => (sector + 1) * sectorSize;
  const fat = fatSectors(bytes, sectorSize);
  const next = (sector: number): number => {
    const fatSector = fat[Math.floor(sector / perSector)];
    return fatSector === undefined ? FREE_SECTOR : u32(bytes, offsetOf(fatSector) + (sector % perSector) * 4);
  };

  const entries: DirEntry[] = [];
  let sector = u32(bytes, 0x30);
  for (let hops = 0; hops < MAX_CHAIN && sector >= 0 && sector < MAX_REGULAR_SECTOR; hops++) {
    const base = offsetOf(sector);
    if (base + sectorSize > bytes.length) break;
    for (let at = base; at < base + sectorSize; at += ENTRY_SIZE) {
      const nameLength = u16(bytes, at + 0x40);
      const type = bytes[at + 0x42];
      if (!type || nameLength < 2 || nameLength > 64) continue;
      entries.push({
        name: utf16le(bytes, at, at + nameLength - 2),
        type,
        start: u32(bytes, at + 0x74),
        size: u32(bytes, at + 0x78),
      });
    }
    sector = next(sector);
  }
  if (entries.length === 0) return null;

  const names = entries.map((e) => e.name);
  const word = entries.find((e) => e.name === "WordDocument" && e.type === 2);
  const encrypted =
    names.some((n) => ENCRYPTION_STREAMS.includes(n)) ||
    (word !== undefined && wordEncrypted(bytes, word, offsetOf, u32(bytes, 0x38)));
  return { names, encrypted };
}

/** FAT sector ids: 109 in the header, the rest through the DIFAT chain. */
function fatSectors(bytes: Uint8Array, sectorSize: number): number[] {
  const total = Math.min(u32(bytes, 0x2c), MAX_FAT_SECTORS);
  const out: number[] = [];
  const push = (id: number): void => {
    if (id >= 0 && id < MAX_REGULAR_SECTOR && out.length < total) out.push(id);
  };
  for (let i = 0; i < 109; i++) push(u32(bytes, 0x4c + i * 4));
  let difat = u32(bytes, 0x44);
  for (let hops = 0; hops < MAX_CHAIN && out.length < total && difat >= 0 && difat < MAX_REGULAR_SECTOR; hops++) {
    const base = (difat + 1) * sectorSize;
    if (base + sectorSize > bytes.length) break;
    for (let at = base; at < base + sectorSize - 4; at += 4) push(u32(bytes, at));
    difat = u32(bytes, base + sectorSize - 4);
  }
  return out;
}

/** Reads the FIB flags at the start of the WordDocument stream (only when it lives in regular sectors). */
function wordEncrypted(
  bytes: Uint8Array,
  word: DirEntry,
  offsetOf: (sector: number) => number,
  miniCutoff: number,
): boolean {
  if (word.size < Math.max(miniCutoff, 0x20) || word.start >= MAX_REGULAR_SECTOR) return false;
  const fib = offsetOf(word.start);
  return u16(bytes, fib) === WORD_IDENT && (u16(bytes, fib + 0x0a) & WORD_ENCRYPTED) !== 0;
}

function scanNames(bytes: Uint8Array): CfbInfo {
  const names = KNOWN_STREAMS.filter((name) => findUtf16(bytes, name) >= 0);
  return { names, encrypted: names.some((n) => ENCRYPTION_STREAMS.includes(n)) };
}

function findUtf16(bytes: Uint8Array, text: string): number {
  const end = Math.min(bytes.length, SCAN_LIMIT) - text.length * 2;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < text.length; j++) {
      if (bytes[i + j * 2] !== text.charCodeAt(j) || bytes[i + j * 2 + 1] !== 0) continue outer;
    }
    return i;
  }
  return -1;
}
