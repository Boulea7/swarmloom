// @ts-check
/**
 * Minimal deterministic ZIP writer (PKZIP 2.0 subset: stored or deflated entries, UTF-8 names, no ZIP64).
 *
 * Store uploads (Chrome Web Store, Edge Add-ons, AMO) and AMO's "rebuild and diff" source review both benefit
 * from archives that do not change when nothing changed: entries keep the caller's order and every entry gets
 * the same timestamp and permissions. With the same Node.js (zlib) version, the same input gives the same bytes.
 */
import { crc32, deflateRawSync } from "node:zlib";

/** @typedef {{ name: string; data: Uint8Array }} ZipEntry */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0: deflate
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED; // host system 3 = Unix, so external attributes carry a mode
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
// MS-DOS date/time for 1980-01-01 00:00:00, the earliest value the format can express.
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = (0 << 9) | (1 << 5) | 1;
// Regular file, rw-r--r--, stored in the high 16 bits of the external attributes.
const FILE_MODE_ATTRIBUTES = (0o100644 << 16) >>> 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

/**
 * Checks that an entry name is a safe, portable relative path with forward slashes.
 * @param {string} name
 * @returns {string} the same name
 */
export function assertSafeEntryName(name) {
  const segments = name.split("/");
  const unsafe =
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (unsafe) throw new Error(`Unsafe zip entry name: ${JSON.stringify(name)}`);
  if (Buffer.byteLength(name, "utf8") > MAX_UINT16) throw new RangeError(`Zip entry name too long: ${name}`);
  return name;
}

/**
 * Builds a ZIP archive in memory. Each entry is deflated when that makes it smaller, otherwise stored.
 * @param {readonly ZipEntry[]} entries files in the order they should appear in the archive
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (entries.length > MAX_UINT16)
    throw new RangeError(`Too many zip entries (${entries.length}); ZIP64 is not supported`);
  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Buffer[]} */
  const centralParts = [];
  const seen = new Set();
  let offset = 0;

  for (const entry of entries) {
    const name = assertSafeEntryName(entry.name);
    if (seen.has(name)) throw new Error(`Duplicate zip entry: ${name}`);
    seen.add(name);

    const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const deflated = deflateRawSync(raw, { level: 9 });
    const method = deflated.length < raw.length ? METHOD_DEFLATE : METHOD_STORE;
    const body = method === METHOD_DEFLATE ? deflated : raw;
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(raw);
    if (raw.length > MAX_UINT32 || offset > MAX_UINT32)
      throw new RangeError("Archive too large; ZIP64 is not supported");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Extra field, comment, disk number and internal attributes stay zero (offsets 30-37).
    central.writeUInt32LE(FILE_MODE_ATTRIBUTES, 38);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBytes, body);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  if (offset > MAX_UINT32 || centralSize > MAX_UINT32)
    throw new RangeError("Archive too large; ZIP64 is not supported");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
