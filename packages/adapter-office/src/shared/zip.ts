import { Inflate } from "fflate";
import { OfficeFormatError } from "./errors";

/** Safety budget for reading one untrusted ZIP container. */
export interface ZipLimits {
  /** Maximum number of central-directory entries. */
  maxEntries: number;
  /** Maximum inflated size of a single entry, bytes. */
  maxEntryBytes: number;
  /** Maximum inflated bytes read across all entries, bytes. */
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN = 22;
const INFLATE_CHUNK = 16 * 1024;

const utf8 = new TextDecoder("utf-8");
const latin1 = new TextDecoder("latin1");

/** True when the bytes start with a local file header ("PK\x03\x04"). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Read-only view of a ZIP container (OOXML / ODF package).
 *
 * The central directory is parsed once; entries are inflated on demand with a streaming
 * inflater that stops as soon as an entry exceeds its declared size or the budget, so a
 * lying header cannot make us allocate unbounded memory. Encrypted entries, ZIP64 and
 * compression methods other than stored/deflate are rejected.
 */
export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();
  private inflated = 0;

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: ZipLimits,
  ) {}

  /** @throws OfficeFormatError when the container is malformed or over a limit. */
  static open(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
    const zip = new ZipArchive(bytes, limits);
    zip.readDirectory();
    return zip;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Inflated bytes of an entry. @throws OfficeFormatError when missing, encrypted or over budget. */
  read(name: string): Uint8Array {
    const entry = this.entries.get(name);
    if (!entry) throw new OfficeFormatError(`Missing part "${name}" in the package`);
    if (entry.flags & 0x1) throw new OfficeFormatError("Encrypted files are not supported");
    if (entry.size > this.limits.maxEntryBytes) {
      throw new OfficeFormatError(`Part "${name}" is too large (${entry.size} bytes)`);
    }
    if (this.inflated + entry.size > this.limits.maxTotalBytes) {
      throw new OfficeFormatError("The package expands beyond the size limit");
    }
    const data = this.compressedData(entry);
    const out = entry.method === 0 ? this.stored(entry, data) : this.inflate(entry, data);
    this.inflated += out.length;
    return out;
  }

  /** Entry decoded as UTF-8 (BOM stripped). */
  readText(name: string): string {
    const text = utf8.decode(this.read(name));
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  private view(): DataView {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  private readDirectory(): void {
    const bytes = this.bytes;
    const view = this.view();
    let eocd = -1;
    const stop = Math.max(0, bytes.length - EOCD_MIN - 0xffff);
    for (let i = bytes.length - EOCD_MIN; i >= stop; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new OfficeFormatError("Not a valid ZIP package (no end of central directory)");
    const count = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new OfficeFormatError("ZIP64 packages are not supported");
    if (count > this.limits.maxEntries) throw new OfficeFormatError(`The package has too many entries (${count})`);
    if (cdOffset + cdSize > eocd) throw new OfficeFormatError("Corrupt ZIP central directory");

    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > eocd || view.getUint32(p, true) !== CEN_SIG)
        throw new OfficeFormatError("Corrupt ZIP central directory");
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const compressedSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
      const name = (flags & 0x800 ? utf8 : latin1).decode(rawName);
      p += 46 + nameLen + extraLen + commentLen;
      if (!isSafeEntryName(name) || this.entries.has(name)) continue;
      this.entries.set(name, { name, method, flags, compressedSize, size, localOffset });
    }
  }

  private compressedData(entry: ZipEntry): Uint8Array {
    const view = this.view();
    const at = entry.localOffset;
    if (at + 30 > this.bytes.length || view.getUint32(at, true) !== LOC_SIG) {
      throw new OfficeFormatError(`Corrupt ZIP entry "${entry.name}"`);
    }
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const end = start + entry.compressedSize;
    if (end > this.bytes.length) throw new OfficeFormatError(`Truncated ZIP entry "${entry.name}"`);
    return this.bytes.subarray(start, end);
  }

  private stored(entry: ZipEntry, data: Uint8Array): Uint8Array {
    if (data.length !== entry.size) throw new OfficeFormatError(`Corrupt stored entry "${entry.name}"`);
    return data.slice();
  }

  private inflate(entry: ZipEntry, data: Uint8Array): Uint8Array {
    if (entry.method !== 8) {
      throw new OfficeFormatError(`Unsupported compression method ${entry.method} in "${entry.name}"`);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const inflater = new Inflate((chunk) => {
      total += chunk.length;
      if (total > entry.size) throw new OfficeFormatError(`Part "${entry.name}" expands beyond its declared size`);
      chunks.push(chunk);
    });
    try {
      if (data.length === 0) inflater.push(new Uint8Array(0), true);
      for (let i = 0; i < data.length; i += INFLATE_CHUNK) {
        const end = Math.min(i + INFLATE_CHUNK, data.length);
        inflater.push(data.subarray(i, end), end === data.length);
      }
    } catch (error) {
      if (error instanceof OfficeFormatError) throw error;
      throw new OfficeFormatError(`Corrupt compressed data in "${entry.name}"`);
    }
    if (total !== entry.size) throw new OfficeFormatError(`Corrupt compressed data in "${entry.name}"`);
    if (chunks.length === 1 && chunks[0]) return chunks[0];
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Package-internal names only: no absolute paths, drive letters, backslashes or `..` segments. */
function isSafeEntryName(name: string): boolean {
  if (!name || name.endsWith("/")) return false;
  if (name.startsWith("/") || name.includes("\\") || /^[a-z]:/i.test(name)) return false;
  return !name.split("/").some((segment) => segment === ".." || segment === ".");
}

/** True when the package is an OpenDocument file of the given kind ("spreadsheet", "presentation"). */
export function isOpenDocument(zip: ZipArchive, kind: string): boolean {
  return zip.has("mimetype") && zip.readText("mimetype").trim() === `application/vnd.oasis.opendocument.${kind}`;
}
