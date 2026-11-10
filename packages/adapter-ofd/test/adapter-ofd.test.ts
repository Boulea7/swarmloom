/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "@swarmloom/adapter-odf/kit";
import type { AdapterContext } from "@swarmloom/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { abbreviatedToSvg, ofdAdapter, ofdColor, openOfd, parseDeltas, sniffOfd } from "../src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sample = new Uint8Array(readFileSync(join(ROOT, "examples/ofd/loom-receipt.ofd")));
const epub = new Uint8Array(readFileSync(join(ROOT, "examples/epub/loom-notes.epub")));
const ctx: AdapterContext = { document, width: 900, theme: "light" };

describe("sniffOfd", () => {
  it.each([
    ["the OFD sample", sample, true],
    [
      "OFD.xml after another entry",
      zipSync({ "Doc_0/Document.xml": strToU8("<x/>"), "OFD.xml": strToU8("<x/>") }, { level: 0 }),
      true,
    ],
    ["an EPUB", epub, false],
    ["a nested OFD.xml", zipSync({ "a/OFD.xml": strToU8("<x/>") }), false],
    ["plain text", strToU8("OFD.xml"), false],
  ])("%s -> %s", (_name, bytes, expected) => {
    expect(sniffOfd(bytes.subarray(0, 4096))).toBe(expected);
  });
});

describe("openOfd", () => {
  it("follows OFD.xml -> Document.xml to pages, templates and resources", () => {
    const pkg = openOfd(ZipArchive.open(sample, "ofd"), window);
    expect(pkg).toMatchObject({
      title: "织机工坊收据",
      documentPath: "Doc_0/Document.xml",
      pageBox: { x: 0, y: 0, w: 210, h: 148 },
      signed: false,
    });
    expect(pkg.pages.map((p) => p.path)).toEqual(["Doc_0/Pages/Page_0/Content.xml", "Doc_0/Pages/Page_1/Content.xml"]);
    expect(pkg.templates.get("2")).toBe("Doc_0/Tpls/Tpl_0/Content.xml");
    expect(pkg.fonts.get("5")).toEqual({ name: "宋体", family: "SimSun" });
    expect(pkg.media.get("9")).toBe("Doc_0/Res/loom.png");
  });
});

describe("OFD primitives", () => {
  it("converts AbbreviatedData to SVG path data and stops at bad numbers", () => {
    expect(abbreviatedToSvg("S 0 12 B 10 -4 20 20 32 8 Q 44 -2 58 10 C")).toBe("M0 12C10 -4 20 20 32 8Q44 -2 58 10Z");
    expect(abbreviatedToSvg("M 2 20 A 18 18 0 1 1 38 20")).toBe("M2 20A18 18 0 1 1 38 20");
    expect(abbreviatedToSvg('M 0 0 L 1 2" onload="x')).toBe("M0 0");
    expect(abbreviatedToSvg("L 5 5")).toBe("M0 0L5 5");
  });

  it("expands DeltaX lists and reads colours", () => {
    expect(parseDeltas("g 3 2.5 1")).toEqual([2.5, 2.5, 2.5, 1]);
    expect(parseDeltas("1 x 2")).toEqual([1, 2]);
    const el = document.createElement("c");
    el.setAttribute("Value", "220 38 38");
    el.setAttribute("Alpha", "128");
    expect(ofdColor(el)).toEqual({ color: "#dc2626", opacity: 128 / 255 });
    el.setAttribute("Value", "300 0 0");
    expect(ofdColor(el)).toBeUndefined();
  });
});

describe("rejections", () => {
  it("refuses a malformed zip", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9, 9, 9]);
    await expect(ofdAdapter.load({ name: "bad.ofd", bytes }, ctx)).rejects.toMatchObject({
      name: "DocumentError",
      code: "malformed",
    });
  });

  it("refuses a zip without OFD.xml and an OFD.xml with a DTD", async () => {
    await expect(ofdAdapter.load({ bytes: zipSync({ "a.txt": strToU8("x") }) }, ctx)).rejects.toThrow(
      /OFD.xml is missing/,
    );
    const dtd = zipSync({
      "OFD.xml": strToU8('<!DOCTYPE x [<!ENTITY a "b">]><ofd:OFD xmlns:ofd="http://www.ofdspec.org/2016"/>'),
    });
    await expect(ofdAdapter.load({ bytes: dtd }, ctx)).rejects.toMatchObject({ code: "malformed" });
  });
});
