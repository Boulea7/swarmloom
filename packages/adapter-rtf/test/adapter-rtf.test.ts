/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRtf, type RtfDocument, type RtfParagraph, type RtfTable, sniffRtf } from "../src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const sample = new Uint8Array(readFileSync(join(ROOT, "examples/rtf/loom-letter.rtf")));
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (p: RtfParagraph) =>
  p.runs.map((r) => (r.type === "text" ? r.text : r.type === "tab" ? "\t" : "")).join("");
const paragraphs = (doc: RtfDocument) => doc.blocks.filter((b): b is RtfParagraph => b.type === "paragraph");
const body = (rtf: string) => paragraphs(parseRtf(bytes(rtf))).map(text);

describe("sniffRtf", () => {
  it.each([
    ["{\\rtf1\\ansi hi}", true],
    ["\n  {\\rtf1 x}", true],
    ["ï»¿{\\rtf1 x}", true],
    ["{\\rt x}", false],
    ["<html>", false],
    ["PK\u0003\u0004", false],
  ])("%j -> %s", (head, expected) => {
    expect(sniffRtf(bytes(head))).toBe(expected);
  });
});

describe("parseRtf on examples/rtf/loom-letter.rtf", () => {
  const doc = parseRtf(sample);
  const all = paragraphs(doc).map(text);

  it("reads the info, page setup, font and colour tables", () => {
    expect(doc).toMatchObject({ title: "Loom letter", author: "SwarmLoom samples", codepage: 936 });
    expect(doc.page).toMatchObject({ width: 11906, height: 16838, left: 1440 });
    expect(doc.fonts.get(1)).toMatchObject({ name: "宋体", charset: 134, codepage: 936 });
    expect(doc.fonts.get(2)).toMatchObject({ name: "細明體", codepage: 950, generic: "serif" });
    expect(doc.defaultFont?.name).toBe("Calibri");
    expect(doc.colors.slice(0, 4)).toEqual([undefined, "#4338ca", "#b45309", "#eef2ff"]);
  });

  it("decodes GBK, Big5 and \\u text with the \\uc skip", () => {
    expect(all).toContain("GBK: 群织让一群光标把文档织成画面。");
    expect(all).toContain("Big5: 繁體中文：經線與緯線。");
    expect(all).toContain("Unicode: 织机笔记 群织");
    expect(all).toContain("•\tWarp: threads stretched along the loom.");
  });

  it("keeps character formatting and skips headers, unknown destinations and field codes", () => {
    const styled = paragraphs(doc).find((p) => text(p).startsWith("Rich Text")) as RtfParagraph;
    const run = (s: string) => styled.runs.find((r) => r.type === "text" && r.text === s);
    expect(run("bold")).toMatchObject({ style: { bold: true, italic: false } });
    expect(run("underline")).toMatchObject({ style: { underline: true } });
    expect(run("colour")).toMatchObject({ style: { color: "#ff6b5b" } });
    expect(run("large")).toMatchObject({ style: { size: 32 } });
    expect(run("super")).toMatchObject({ style: { vertical: "super" } });
    expect(text(styled)).toContain("“curly”");
    expect(all.join(" ")).not.toMatch(/must not appear|header is skipped|HYPERLINK/);
    expect(all).toContain("Unknown destinations are ignored: done. A field result stays.");
    expect(doc.stats.headers).toBe(1);
  });

  it("builds the table, the picture and the page break", () => {
    const table = doc.blocks.find((b): b is RtfTable => b.type === "table") as RtfTable;
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]?.cells.map((c) => text(c.paragraphs[0] as RtfParagraph))).toEqual(["项目", "经线", "纬线"]);
    expect(table.rows[0]?.cells.map((c) => [c.right, c.background])).toEqual([
      [3000, "#eef2ff"],
      [6000, "#eef2ff"],
      [9026, "#eef2ff"],
    ]);
    expect(table.rows[0]?.bordered).toBe(true);
    const image = doc.blocks.flatMap((b) => (b.type === "paragraph" ? b.runs : [])).find((r) => r.type === "image");
    expect(image).toMatchObject({ type: "image", mime: "image/png", width: 1440, height: 1440 });
    expect(doc.stats.unsupportedPictures).toBe(0);
    expect(doc.blocks.filter((b) => b.type === "page-break")).toHaveLength(1);
    expect(all.at(-1)).toBe("After an explicit page break.");
  });
});

describe("parseRtf details", () => {
  it("skips \\uc characters, including \\'hh and control symbols", () => {
    expect(body("{\\rtf1\\uc2 a\\u8364\\'80\\'80b\\par}")).toEqual(["a\u20ACb"]);
    expect(body("{\\rtf1\\uc0 \\u-3913 x\\par}")).toEqual(["\uF0B7x"]);
    expect(body("{\\rtf1 \\u8212\\~x\\par}")).toEqual(["\u2014x"]);
  });

  it("decodes \\'hh with the document code page", () => {
    expect(body("{\\rtf1\\ansi\\ansicpg950 \\'a4\\'a4\\'a4\\'e5\\par}")).toEqual(["中文"]);
    expect(body("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8\\par}")).toEqual(["При"]);
    expect(body("{\\rtf1\\ansi caf\\'e9\\par}")).toEqual(["café"]);
  });

  it("reads \\bin picture data and treats metafiles as placeholders", () => {
    const png = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
    ];
    const doc = parseRtf(
      bytes(
        `{\\rtf1 {\\pict\\pngblip\\bin${png.length} ${String.fromCharCode(...png)}}{\\pict\\emfblip\\picwgoal720 0102}\\par}`,
      ),
    );
    const runs = (doc.blocks[0] as RtfParagraph).runs;
    expect(runs[0]).toMatchObject({ type: "image", mime: "image/png" });
    expect(runs[1]).toMatchObject({ type: "unsupported-image", format: "emf", width: 720 });
    expect(doc.stats.unsupportedPictures).toBe(1);
  });

  it.each([
    ["a missing closing brace", "{\\rtf1 {\\b bold\\par}"],
    ["an extra closing brace", "{\\rtf1 text}}"],
    ["a stray brace inside", "{\\rtf1 a}b}"],
    ["not RTF at all", "plain text"],
    ["truncated \\bin data", "{\\rtf1 {\\pict\\bin99 ab}}"],
  ])("rejects %s", (_name, rtf) => {
    expect(() => parseRtf(bytes(rtf))).toThrow(expect.objectContaining({ name: "DocumentError", code: "malformed" }));
  });

  it("rejects groups nested past the limit", () => {
    expect(() => parseRtf(bytes(`{\\rtf1 ${"{".repeat(40)}x${"}".repeat(40)}}`), { maxDepth: 32 })).toThrow(
      /nested deeper/,
    );
  });
});
