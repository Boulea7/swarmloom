// Deterministic zip writer (and a small reader for tests). No dependencies: node:zlib only.
// Same input tree -> byte-identical archive: sorted entries, one fixed timestamp (1980-01-01, or
// SOURCE_DATE_EPOCH when set), no extra fields. Deflate output can differ between zlib versions,
// so reproducing an archive also needs the same Node major (recorded by amo-source.mjs).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** Earliest time a zip entry can carry (MS-DOS epoch), used when no SOURCE_DATE_EPOCH is given. */
const DOS_EPOCH = Date.UTC(1980, 0, 1);
/** General purpose flag bit 11: names are UTF-8. */
const UTF8_FLAG = 0x0800;

/**
 * @typedef {{ name: string; data: Buffer | Uint8Array }} ZipEntry
 */

/**
 * Parses SOURCE_DATE_EPOCH (seconds since 1970, UTC).
 * @param {string | undefined} value
 * @returns {Date | undefined} undefined when unset
 * @throws {Error} when set but not a non-negative integer
 */
export function sourceDateEpoch(value) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`SOURCE_DATE_EPOCH must be whole seconds, got "${value}"`);
  return new Date(Number(value) * 1000);
}

/**
 * MS-DOS time and date fields (UTC, 2-second resolution, clamped to 1980..2107).
 * @param {Date} date
 */
function dosDateTime(date) {
  const d = new Date(Math.min(Math.max(date.getTime(), DOS_EPOCH), Date.UTC(2107, 11, 31, 23, 59, 58)));
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const day = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, day };
}

/**
 * Creates a zip archive from in-memory entries (sorted by name for determinism).
 * @param {ZipEntry[]} entries
 * @param {{ mtime?: Date }} [options] Timestamp of every entry. Default 1980-01-01.
 * @returns {Buffer}
 */
export function zipEntries(entries, options = {}) {
  const { time: dosTime, day: dosDate } = dosDateTime(options.mtime ?? new Date(DOS_EPOCH));
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      throw new Error(`unsafe zip entry name: ${name}`);
    }
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Lists every file under `dir` as zip entries with forward-slash relative names.
 * @param {string} dir
 * @returns {ZipEntry[]}
 */
export function directoryEntries(dir) {
  /** @type {ZipEntry[]} */
  const out = [];
  const walk = (/** @type {string} */ current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push({ name: relative(dir, path).split(sep).join("/"), data: readFileSync(path) });
    }
  };
  walk(dir);
  return out;
}

/**
 * Reads a zip produced by {@link zipEntries} (no zip64, no data descriptors). For tests and checks.
 * @param {Buffer} zip
 * @returns {ZipEntry[]}
 */
export function unzipEntries(zip) {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error("not a zip archive");
  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  /** @type {ZipEntry[]} */
  const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const body = zip.subarray(dataAt, dataAt + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`crc mismatch in ${name}`);
    out.push({ name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}
