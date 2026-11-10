// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";
import { assertSafeEntryName, createZip } from "../lib/zip.mjs";

/**
 * Reads the archive back through its central directory, the way unzip tools do.
 * @param {Buffer} zip
 * @returns {{ name: string; data: Buffer; method: number; date: number }[]}
 */
function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory record");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const date = zip.readUInt16LE(offset + 14);
    const checksum = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = zip.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), checksum, `crc of ${name}`);
    entries.push({ name, data, method, date });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("createZip round-trips entries in order with fixed timestamps", () => {
  const input = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify({ name: "x".repeat(200) })) },
    { name: "icons/16.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: "_locales/zh_CN/messages.json", data: Buffer.from('{"name":{"message":"群织"}}') },
  ];
  const zip = createZip(input);
  const output = readZip(zip);
  assert.deepEqual(
    output.map(({ name, data }) => ({ name, data: data.toString("hex") })),
    input.map(({ name, data }) => ({ name, data: data.toString("hex") })),
  );
  assert.equal(output[0].method, 8, "compressible data is deflated");
  assert.equal(output[1].method, 0, "tiny data is stored");
  assert.ok(
    output.every((entry) => entry.date === 0x21),
    "1980-01-01",
  );
  assert.ok(createZip(input).equals(zip), "same input, same bytes");
});

test("createZip rejects unsafe and duplicate names", () => {
  for (const name of ["", "/abs", "../up", "a/../b", "a//b", "./a", "a\\b", "C:/x", "dir/", "nul\0"]) {
    assert.throws(() => assertSafeEntryName(name), /Unsafe zip entry name/, JSON.stringify(name));
  }
  assert.equal(assertSafeEntryName("assets/studio.js"), "assets/studio.js");
  const data = Buffer.from("x");
  assert.throws(
    () =>
      createZip([
        { name: "a", data },
        { name: "a", data },
      ]),
    /Duplicate zip entry/,
  );
});
