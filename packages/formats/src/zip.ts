import { u16, u32, u64 } from "./bytes";

/** What format detection needs from a ZIP container. */
export interface ZipInfo {
  /** Entry names in directory order (forward slashes, as stored). */
  names: string[];
  /** True when any entry uses traditional or strong ZIP encryption (general purpose flag bit 0). */
  encrypted: boolean;
  /** Content of a stored `mimetype` entry (OpenDocument, EPUB), when present. */
  mimetype?: string;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
/** Detection never needs more names than this; huge directories are read partially. */
const MAX_ENTRIES = 4096;
const MAX_MIMETYPE = 128;

const names = new TextDecoder();

/**
 * Reads entry names from a ZIP file without inflating anything.
 *
 * Uses the central directory (found through the end-of-central-directory record, ZIP64 aware)
 * and falls back to walking local file headers when the directory is missing, for example when
 * only the head of a large file is available. Every offset is bounds-checked; malformed input
 * yields `null` or a partial listing, never an exception.
 *
 * @param bytes The whole file, or as much of its head as is available.
 * @returns Entry names and flags, or `null` when no entry could be read.
 */
export function readZip(bytes: Uint8Array): ZipInfo | null {
  return readCentral(bytes) ?? scanLocal(bytes);
}

function findEocd(bytes: Uint8Array): number {
  // The record is 22 bytes plus a comment of at most 65535 bytes, so it sits in the last ~64 KB.
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= stop; i--) if (u32(bytes, i) === SIG_EOCD) return i;
  return -1;
}

function readCentral(bytes: Uint8Array): ZipInfo | null {
  const eocd = findEocd(bytes);
  if (eocd < 0) return null;
  let count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (u32(bytes, locator) !== SIG_EOCD64_LOCATOR) return null;
    const record = u64(bytes, locator + 8);
    if (u32(bytes, record) !== SIG_EOCD64) return null;
    count = u64(bytes, record + 32);
    offset = u64(bytes, record + 48);
  }
  if (count < 0 || offset < 0 || u32(bytes, offset) !== SIG_CENTRAL) return null;

  const info: ZipInfo = { names: [], encrypted: false };
  let p = offset;
  for (let i = 0; i < Math.min(count, MAX_ENTRIES) && u32(bytes, p) === SIG_CENTRAL; i++) {
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    const nameEnd = p + 46 + nameLength;
    if (nameLength < 0 || extraLength < 0 || commentLength < 0 || nameEnd > bytes.length) break;
    const name = names.decode(bytes.subarray(p + 46, nameEnd));
    info.names.push(name);
    if (flags & 1) info.encrypted = true;
    if (name === "mimetype" && method === 0) info.mimetype = readStoredAt(bytes, localOffset, size);
    p = nameEnd + extraLength + commentLength;
  }
  return info.names.length > 0 ? info : null;
}

/** Reads a small uncompressed entry through its local header. */
function readStoredAt(bytes: Uint8Array, localOffset: number, size: number): string | undefined {
  if (size < 0 || size > MAX_MIMETYPE || u32(bytes, localOffset) !== SIG_LOCAL) return undefined;
  const start = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
  if (start + size > bytes.length) return undefined;
  return names.decode(bytes.subarray(start, start + size)).trim();
}

function scanLocal(bytes: Uint8Array): ZipInfo | null {
  const info: ZipInfo = { names: [], encrypted: false };
  let p = 0;
  for (let i = 0; i < MAX_ENTRIES && u32(bytes, p) === SIG_LOCAL; i++) {
    const flags = u16(bytes, p + 6);
    const method = u16(bytes, p + 8);
    const size = u32(bytes, p + 18);
    const nameLength = u16(bytes, p + 26);
    const extraLength = u16(bytes, p + 28);
    const dataStart = p + 30 + nameLength + extraLength;
    if (size < 0 || nameLength < 0 || extraLength < 0 || p + 30 + nameLength > bytes.length) break;
    const name = names.decode(bytes.subarray(p + 30, p + 30 + nameLength));
    info.names.push(name);
    if (flags & 1) info.encrypted = true;
    if (name === "mimetype" && method === 0) info.mimetype = readStoredAt(bytes, p, size);
    // With a trailing data descriptor (bit 3) the header may carry no size: the next entry cannot be located.
    if (flags & 8 && size === 0) break;
    p = dataStart + size;
  }
  return info.names.length > 0 ? info : null;
}
