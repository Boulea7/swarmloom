import type { Blueprint } from "@swarmloom/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ContentBudget, FontReport, fontStack, markSheets, parseXml, resolvePath, ZipArchive } from "../src/kit/index";

describe("ZipArchive limits", () => {
  it("reads entries and rejects unsafe names", () => {
    const zip = ZipArchive.open(zipSync({ "a/b.txt": strToU8("hello") }), "test");
    expect(zip.text("a/b.txt")).toBe("hello");
    expect(() => ZipArchive.open(zipSync({ "../evil.txt": strToU8("x") }), "test")).toThrow(/unsafe entry name/);
    expect(() => ZipArchive.open(zipSync({ "/abs.txt": strToU8("x") }), "test")).toThrow(/unsafe entry name/);
  });

  it("refuses compression bombs, oversized entries and too many entries", () => {
    const bomb = zipSync({ "zeros.bin": new Uint8Array(4 * 1024 * 1024) }, { level: 9 });
    expect(() => ZipArchive.open(bomb, "test").read("zeros.bin")).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
    const big = ZipArchive.open(zipSync({ "a.bin": new Uint8Array(2048) }, { level: 0 }), "test", { maxEntry: 1024 });
    expect(() => big.read("a.bin")).toThrow(expect.objectContaining({ code: "too-large" }));
    const many = zipSync(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, strToU8("x")])));
    expect(() => ZipArchive.open(many, "test", { maxEntries: 4 })).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  it.each([
    ["OEBPS/text/c1.xhtml", "../img/a.png", "OEBPS/img/a.png"],
    ["OEBPS/c1.xhtml", "/root.css", "root.css"],
    ["a/b.xml", "c%20d.png#x", "a/c d.png"],
    ["a.xml", "../../x", null],
    ["a.xml", "https://example.invalid/x.png", null],
  ])("resolvePath(%s, %s) -> %s", (from, href, expected) => {
    expect(resolvePath(from, href)).toBe(expected);
  });
});

describe("parseXml", () => {
  it("rejects entity declarations and deep nesting", () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', { format: "t", part: "p" })).toThrow(
      /document type/,
    );
    expect(() =>
      parseXml(`${"<a>".repeat(20)}${"</a>".repeat(20)}`, { format: "t", part: "p", limits: { maxDepth: 10 } }),
    ).toThrow(/deeper/);
  });
});

describe("F01 font fallbacks", () => {
  it.each([
    ["Calibri", "Carlito", "sans-serif"],
    ["Cambria", "Caladea", "serif"],
    ["Times New Roman", "Liberation Serif", "serif"],
    ["Courier New", "Liberation Mono", "monospace"],
    ["宋体", "Noto Serif SC", "serif"],
    ["微软雅黑", "Noto Sans SC", "sans-serif"],
    ["KaiTi", "Noto Serif SC", "serif"],
  ])("%s -> %s", (name, substitute, generic) => {
    const choice = fontStack(name);
    expect(choice.substitute).toBe(substitute);
    expect(choice.stack.startsWith(`"${name}"`)).toBe(true);
    expect(choice.stack.endsWith(`, ${generic}`)).toBe(true);
  });

  it("strips characters that could break out of CSS and reports substitutions once", () => {
    // The injected name stays inside its own quoted string: no ; { } ( ) can reach the declaration.
    const stack = fontStack('Evil"; background:url(x)').stack;
    expect(stack.startsWith('"Evil background:urlx", ')).toBe(true);
    expect(stack).not.toMatch(/[;{}()]/);
    const report = new FontReport();
    report.use("Calibri");
    report.use("calibri");
    report.use("Unknown Face");
    expect(report.note()).toBe("Fonts shown with open substitutes when not installed: Calibri -> Carlito.");
  });
});

describe("ContentBudget", () => {
  it("accepts the unit that crosses a limit and counts the rest as dropped", () => {
    const budget = new ContentBudget({ units: 3, chars: 100 });
    expect([budget.take(10), budget.take(95), budget.take(1), budget.take(1)]).toEqual([true, true, false, false]);
    budget.skip(5);
    expect(budget.dropped).toBe(7);
  });
});

describe("markSheets", () => {
  it("marks sheet-sized boxes, replacing the section role inferred from <section>", () => {
    const box = (id: string, w: number, h: number, role?: "section" | "paragraph") => ({
      id,
      kind: "box" as const,
      box: { x: 0, y: 0, w, h },
      ...(role ? { role } : {}),
    });
    const bp = {
      layers: [
        box("desk", 858, 2341),
        box("a", 793.7, 1122.5, "section"),
        box("b", 793.7, 1122.5),
        box("c", 793.7, 1122.5, "paragraph"),
        box("d", 600, 1122.5),
      ],
    } as unknown as Blueprint;
    markSheets(bp, [{ w: 793.7, h: 1122.5, fixed: true }], "page");
    expect(bp.layers.map((l) => l.role)).toEqual([undefined, "page", "page", "paragraph", undefined]);
  });
});
