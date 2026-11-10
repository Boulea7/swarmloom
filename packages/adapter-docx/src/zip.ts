import { DocxError } from "./errors";

/** Limits applied to the ZIP central directory before any part is decompressed. */
export interface ZipLimits {
  maxEntries: number;
  /** Sum of uncompressed sizes, bytes. */
  maxTotal: number;
  /** Largest allowed uncompressed/compressed ratio for entries above 1 MB. */
  maxRatio: number;
}

/** Limits for untrusted ZIP containers (product-spec A.1): 10,000 entries, 512 MiB unpacked, 200:1 ratio. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 10_000, maxTotal: 512 * 1024 * 1024, maxRatio: 200 };

export interface ZipEntry {
  name: string;
  compressedSize: number;
  size: number;
  encrypted: boolean;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const LARGE_ENTRY = 1024 * 1024;
const NAMES = new TextDecoder("utf-8");

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Reads the ZIP central directory without decompressing anything and enforces `limits`
 * (entry count, total size, compression ratio, no ZIP64, no encrypted entries).
 *
 * @throws DocxError "corrupt" for a malformed directory, "too-large" when a limit is exceeded.
 */
export function inspectZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new DocxError("corrupt", "no ZIP end-of-directory record");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new DocxError("too-large", "ZIP64 packages are not supported");
  }
  if (count > limits.maxEntries) throw new DocxError("too-large", `${count} package entries`);
  if (cdOffset + cdSize > eocd) throw new DocxError("corrupt", "ZIP directory outside the file");

  const entries: ZipEntry[] = [];
  let total = 0;
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CDH_SIG) throw new DocxError("corrupt", "broken ZIP directory");
    const flags = view.getUint16(at + 8, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (at + 46 + nameLength > eocd) throw new DocxError("corrupt", "broken ZIP directory");
    const name = NAMES.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (!isSafeEntryName(name))
      throw new DocxError("corrupt", `unsafe entry name ${JSON.stringify(name.slice(0, 80))}`);
    if (compressedSize === 0xffffffff || size === 0xffffffff)
      throw new DocxError("too-large", "ZIP64 entries are not supported");
    total += size;
    if (total > limits.maxTotal) throw new DocxError("too-large", "the unpacked document is too large");
    if (size > LARGE_ENTRY && size > compressedSize * limits.maxRatio) {
      throw new DocxError("too-large", `suspicious compression ratio in ${name}`);
    }
    entries.push({ name, compressedSize, size, encrypted: (flags & 1) !== 0 });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Entry names must be relative paths without ".." segments, drive letters or backslashes. */
export function isSafeEntryName(name: string): boolean {
  if (name === "" || name.startsWith("/") || name.includes("\\") || /^[a-z]:/i.test(name)) return false;
  return !name.split("/").some((segment) => segment === "..");
}

function findEocd(view: DataView): number {
  const end = view.byteLength - EOCD_MIN;
  const stop = Math.max(0, end - MAX_COMMENT);
  for (let at = end; at >= stop; at--) if (view.getUint32(at, true) === EOCD_SIG) return at;
  return -1;
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const pattern = Array.from(text).flatMap((c) => [c.charCodeAt(0), 0]);
  outer: for (let i = 0; i + pattern.length <= bytes.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Validates that `bytes` is a renderable Word package and returns its entries.
 * OLE files are classified as password-protected OOXML or legacy Word so the user gets a useful message.
 */
export function checkDocxPackage(bytes: Uint8Array, limits?: ZipLimits): ZipEntry[] {
  if (bytes.length >= 8 && CFB_MAGIC.every((b, i) => bytes[i] === b)) {
    if (containsUtf16(bytes, "EncryptedPackage")) throw new DocxError("encrypted");
    if (containsUtf16(bytes, "WordDocument")) throw new DocxError("legacy-doc");
    throw new DocxError("not-docx", "an OLE compound file");
  }
  if (!isZip(bytes)) throw new DocxError("not-docx");
  const entries = inspectZip(bytes, limits);
  if (entries.some((e) => e.encrypted)) throw new DocxError("encrypted", "encrypted ZIP entries");
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml") || !entries.some((e) => /^word\/[^/]+\.xml$/i.test(e.name))) {
    const kind = entries.some((e) => e.name.startsWith("xl/"))
      ? "a spreadsheet"
      : entries.some((e) => e.name.startsWith("ppt/"))
        ? "a presentation"
        : "no Word main document";
    throw new DocxError("not-docx", kind);
  }
  return entries;
}
