import { inflateSync } from "fflate";
import { DocumentError } from "./errors";

/** Safety limits for ZIP containers (product-spec A.1). */
export interface ZipLimits {
  /** Most entries in the central directory. */
  maxEntries: number;
  /** Most bytes inflated over the life of one archive. */
  maxTotal: number;
  /** Most bytes of one entry. */
  maxEntry: number;
  /** Highest uncompressed:compressed ratio of an entry larger than 64 KiB. */
  maxRatio: number;
}

const MIB = 1024 * 1024;

export const ZIP_LIMITS: Readonly<ZipLimits> = {
  maxEntries: 10_000,
  maxTotal: 512 * MIB,
  maxEntry: 128 * MIB,
  maxRatio: 200,
};

interface Entry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const RATIO_FLOOR = 64 * 1024;

const utf8 = new TextDecoder("utf-8");

/** True for names that could escape the archive root when extracted: `..` segments, absolute or drive paths. */
function unsafeName(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  return n.startsWith("/") || /^[a-z]:/i.test(n) || n.split("/").includes("..");
}

/**
 * Read-only view of a ZIP archive that inflates entries on demand.
 *
 * The central directory is parsed once (ZIP64 aware, every offset bounds-checked). Entries are
 * inflated into buffers sized from the directory, so a lying header cannot grow memory, and the
 * running total, per-entry size and compression ratio are checked against {@link ZipLimits}.
 */
export class ZipArchive {
  private readonly entries = new Map<string, Entry>();
  private inflated = 0;

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly format: string,
    private readonly limits: ZipLimits,
  ) {}

  /**
   * Opens `bytes` as a ZIP archive.
   *
   * @throws DocumentError `malformed` for anything that is not a well-formed archive or has unsafe
   *   entry names, `too-large` when the entry count exceeds the limit.
   */
  static open(bytes: Uint8Array, format: string, limits: Partial<ZipLimits> = {}): ZipArchive {
    const zip = new ZipArchive(bytes, format, { ...ZIP_LIMITS, ...limits });
    zip.readDirectory();
    return zip;
  }

  /** Entry names in directory order. */
  get names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Declared uncompressed size of an entry, or undefined when missing. */
  size(name: string): number | undefined {
    return this.entries.get(name)?.size;
  }

  /** True when the entry uses ZIP-level (traditional or strong) encryption. */
  isEncrypted(name: string): boolean {
    return ((this.entries.get(name)?.flags ?? 0) & 1) === 1;
  }

  /**
   * Inflates one entry.
   *
   * @throws DocumentError `malformed` when missing or corrupt, `encrypted` for encrypted entries,
   *   `too-large` when a limit is hit, `unsupported` for compression methods other than store/deflate.
   */
  read(name: string): Uint8Array {
    const entry = this.entries.get(name);
    if (!entry) throw this.fail("malformed", `the package has no "${name}" entry`);
    if (entry.flags & 1) throw this.fail("encrypted", `"${name}" is encrypted`);
    if (entry.size > this.limits.maxEntry)
      throw this.fail("too-large", `"${name}" is larger than ${this.limits.maxEntry} bytes`);
    if (entry.size > RATIO_FLOOR && entry.size / Math.max(1, entry.compressedSize) > this.limits.maxRatio) {
      throw this.fail("too-large", `"${name}" has a suspicious compression ratio`);
    }
    if (this.inflated + entry.size > this.limits.maxTotal) {
      throw this.fail("too-large", `the package inflates to more than ${this.limits.maxTotal} bytes`);
    }
    const data = this.entryData(entry);
    let out: Uint8Array;
    if (entry.method === 0) {
      if (data.length < entry.size) throw this.fail("malformed", `"${name}" is truncated`);
      out = data.slice(0, entry.size);
    } else if (entry.method === 8) {
      try {
        out = entry.size === 0 ? new Uint8Array(0) : inflateSync(data, { out: new Uint8Array(entry.size) });
      } catch (cause) {
        throw new DocumentError(this.format, "malformed", `"${name}" is corrupt`, { cause });
      }
    } else {
      throw this.fail("unsupported", `"${name}" uses compression method ${entry.method}`);
    }
    this.inflated += entry.size;
    return out;
  }

  /** Inflates an entry and decodes it as UTF-8 (a BOM is dropped). */
  text(name: string): string {
    const text = utf8.decode(this.read(name));
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /** Reads a stored `mimetype` entry (OpenDocument, EPUB), trimmed, or undefined. */
  mimetype(): string | undefined {
    const entry = this.entries.get("mimetype");
    if (!entry || entry.size > 256) return undefined;
    return this.text("mimetype").trim();
  }

  private fail(code: "malformed" | "encrypted" | "too-large" | "unsupported", message: string): DocumentError {
    return new DocumentError(this.format, code, message);
  }

  private u16(p: number): number {
    if (p < 0 || p + 2 > this.bytes.length) throw this.fail("malformed", "the ZIP structure is truncated");
    return (this.bytes[p] as number) | ((this.bytes[p + 1] as number) << 8);
  }

  private u32(p: number): number {
    return (this.u16(p) | (this.u16(p + 2) << 16)) >>> 0;
  }

  private u64(p: number): number {
    const value = this.u32(p) + this.u32(p + 4) * 2 ** 32;
    if (!Number.isSafeInteger(value)) throw this.fail("malformed", "a ZIP64 field is out of range");
    return value;
  }

  private findEocd(): number {
    const b = this.bytes;
    const stop = Math.max(0, b.length - 22 - 0xffff);
    for (let i = b.length - 22; i >= stop; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
    }
    return -1;
  }

  private readDirectory(): void {
    const eocd = this.findEocd();
    if (eocd < 0 || this.u32(eocd) !== SIG_EOCD)
      throw this.fail("malformed", "not a ZIP package (no end of central directory)");
    let count = this.u16(eocd + 10);
    let offset = this.u32(eocd + 16);
    if (count === 0xffff || offset === 0xffffffff) {
      const locator = eocd - 20;
      if (locator < 0 || this.u32(locator) !== SIG_EOCD64_LOCATOR)
        throw this.fail("malformed", "broken ZIP64 directory");
      const record = this.u64(locator + 8);
      if (this.u32(record) !== SIG_EOCD64) throw this.fail("malformed", "broken ZIP64 directory");
      count = this.u64(record + 32);
      offset = this.u64(record + 48);
    }
    if (count === 0) throw new DocumentError(this.format, "empty", "the package has no entries");
    if (count > this.limits.maxEntries)
      throw this.fail("too-large", `the package has more than ${this.limits.maxEntries} entries`);
    let p = offset;
    for (let i = 0; i < count; i++) {
      if (this.u32(p) !== SIG_CENTRAL) throw this.fail("malformed", "the central directory is corrupt");
      const nameLength = this.u16(p + 28);
      const extraLength = this.u16(p + 30);
      const commentLength = this.u16(p + 32);
      const nameEnd = p + 46 + nameLength;
      if (nameEnd + extraLength > this.bytes.length) throw this.fail("malformed", "the central directory is truncated");
      const entry: Entry = {
        name: utf8.decode(this.bytes.subarray(p + 46, nameEnd)),
        flags: this.u16(p + 8),
        method: this.u16(p + 10),
        compressedSize: this.u32(p + 20),
        size: this.u32(p + 24),
        offset: this.u32(p + 42),
      };
      this.applyZip64(entry, nameEnd, extraLength);
      if (unsafeName(entry.name)) throw this.fail("malformed", `unsafe entry name "${entry.name}"`);
      if (!this.entries.has(entry.name)) this.entries.set(entry.name, entry);
      p = nameEnd + extraLength + commentLength;
    }
  }

  /** Replaces 0xFFFFFFFF sizes and offsets with the values of the ZIP64 extra field. */
  private applyZip64(entry: Entry, start: number, length: number): void {
    if (entry.size !== 0xffffffff && entry.compressedSize !== 0xffffffff && entry.offset !== 0xffffffff) return;
    let p = start;
    while (p + 4 <= start + length) {
      const id = this.u16(p);
      const size = this.u16(p + 2);
      if (id === 0x0001) {
        let q = p + 4;
        if (entry.size === 0xffffffff) {
          entry.size = this.u64(q);
          q += 8;
        }
        if (entry.compressedSize === 0xffffffff) {
          entry.compressedSize = this.u64(q);
          q += 8;
        }
        if (entry.offset === 0xffffffff) entry.offset = this.u64(q);
        return;
      }
      p += 4 + size;
    }
    throw this.fail("malformed", `"${entry.name}" lacks its ZIP64 sizes`);
  }

  private entryData(entry: Entry): Uint8Array {
    const p = entry.offset;
    if (this.u32(p) !== SIG_LOCAL) throw this.fail("malformed", `"${entry.name}" has no local header`);
    const start = p + 30 + this.u16(p + 26) + this.u16(p + 28);
    const end = start + entry.compressedSize;
    if (end > this.bytes.length) throw this.fail("malformed", `"${entry.name}" is truncated`);
    return this.bytes.subarray(start, end);
  }
}

/**
 * Resolves `href` against the directory of `from` inside an archive: `("OEBPS/text/c1.xhtml",
 * "../img/a.png")` -> `"OEBPS/img/a.png"`. A leading slash starts at the archive root. Fragments and
 * queries are dropped and percent-escapes decoded. Returns null for URLs with a scheme and for paths
 * that climb above the root.
 */
export function resolvePath(from: string, href: string): string | null {
  const raw = href.trim().replace(/[#?].*$/, "");
  if (raw === "" || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const base = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  const parts = [...base];
  for (const seg of decoded.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/** Name and stored content of the first local entry of a ZIP head, for sniffing. */
export interface FirstEntry {
  name: string;
  /** Content when the entry is stored uncompressed and fits in the head. */
  stored?: Uint8Array;
}

function headU16(b: Uint8Array, p: number): number {
  return p + 2 <= b.length ? (b[p] as number) | ((b[p + 1] as number) << 8) : -1;
}

function headU32(b: Uint8Array, p: number): number {
  const lo = headU16(b, p);
  const hi = headU16(b, p + 2);
  return lo < 0 || hi < 0 ? -1 : (lo | (hi << 16)) >>> 0;
}

/** Reads the first local file header of `head` (no central directory needed). */
export function firstZipEntry(head: Uint8Array): FirstEntry | null {
  if (headU32(head, 0) !== SIG_LOCAL) return null;
  const nameLength = headU16(head, 26);
  const extraLength = headU16(head, 28);
  if (nameLength <= 0 || 30 + nameLength > head.length) return null;
  const name = utf8.decode(head.subarray(30, 30 + nameLength));
  const method = headU16(head, 8);
  const size = headU32(head, 18);
  const start = 30 + nameLength + extraLength;
  if (method === 0 && size >= 0 && start + size <= head.length)
    return { name, stored: head.subarray(start, start + size) };
  return { name };
}

/**
 * Entry names found by walking local headers through `head` (stops at the first entry whose size
 * is unknown or that runs past the head). Used for sniffing package types by their parts.
 */
export function zipHeadNames(head: Uint8Array, max = 64): string[] {
  const names: string[] = [];
  let p = 0;
  while (names.length < max && headU32(head, p) === SIG_LOCAL) {
    const flags = headU16(head, p + 6);
    const compressed = headU32(head, p + 18);
    const nameLength = headU16(head, p + 26);
    const extraLength = headU16(head, p + 28);
    if (nameLength <= 0 || p + 30 + nameLength > head.length) break;
    names.push(utf8.decode(head.subarray(p + 30, p + 30 + nameLength)));
    if (flags & 8 && compressed === 0) break;
    p += 30 + nameLength + extraLength + compressed;
  }
  return names;
}
