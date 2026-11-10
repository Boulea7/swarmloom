// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { checkAgainstExtension, checkListing, declaredPermissions, readImageInfo } from "../check-store.mjs";

/** @param {string} locale */
const readListing = (locale) =>
  parse(readFileSync(new URL(`../../../store/listing/${locale}.yaml`, import.meta.url), "utf8"));

test("the shipped listings pass the store limits", () => {
  for (const locale of ["en", "zh-CN"]) {
    assert.deepEqual(checkListing(readListing(locale), locale), { errors: [], warnings: [] }, locale);
  }
});

test("checkListing reports limit violations", () => {
  const listing = { ...readListing("en"), name: "S", summary: "See https://example.com", keywords: "ok,3d" };
  const { errors } = checkListing(listing, "en");
  assert.ok(errors.some((e) => e.includes("name needs at least 2")));
  assert.ok(errors.some((e) => e.includes("must not contain URLs")));
  assert.ok(errors.some((e) => e.includes('keyword "3d"')));
  assert.ok(checkListing(readListing("en"), "zh-CN").errors[0].includes("locale field"));
});

test("checkAgainstExtension compares with the shipped manifest and messages", () => {
  const listing = readListing("en");
  const manifest = {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    permissions: ["activeTab", "scripting", "tabs"],
    optional_host_permissions: ["<all_urls>"],
  };
  assert.deepEqual(declaredPermissions(manifest), ["activeTab", "scripting", "tabs", "optional_host_permissions"]);
  const messages = { extname: { message: listing.name }, extDescription: { message: "Something else" } };
  const { errors, warnings } = checkAgainstExtension(listing, "en", { manifest, messages });
  assert.deepEqual(
    errors.map((e) => e.replace(/ ".*/, "")),
    ["en: listing short", "en: no justification for permission tabs"],
  );
  assert.ok(
    warnings.some((w) => w.includes("contextMenus")),
    "justified but not declared",
  );
});

/**
 * Minimal PNG: signature, IHDR and optionally a tRNS chunk (CRCs are not checked by the reader).
 * @param {number} width
 * @param {number} height
 * @param {number} colorType
 * @param {boolean} [trns]
 */
function png(width, height, colorType, trns = false) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = colorType;
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr];
  if (trns) chunks.push(Buffer.from([0, 0, 0, 2, 0x74, 0x52, 0x4e, 0x53, 0, 0, 0, 0, 0, 0]));
  chunks.push(Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]));
  return Buffer.concat(chunks);
}

test("readImageInfo reads PNG and JPEG headers", () => {
  assert.deepEqual(readImageInfo(png(1280, 800, 2)), { format: "png", width: 1280, height: 800, alpha: false });
  assert.equal(readImageInfo(png(440, 280, 6)).alpha, true);
  assert.equal(readImageInfo(png(440, 280, 2, true)).alpha, true);
  // SOI, an APP0 segment, then a baseline SOF0 with height 560 and width 1400.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x30, 0x05, 0x78, 0x03,
  ]);
  assert.deepEqual(readImageInfo(jpeg), { format: "jpeg", width: 1400, height: 560, alpha: false });
  assert.throws(() => readImageInfo(Buffer.from("GIF89a")), /not a PNG or JPEG/);
});
