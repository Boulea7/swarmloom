/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { OfficeFormatError } from "../src/shared/errors";
import { ZipArchive } from "../src/shared/zip";
import type { Cell, SheetModel } from "../src/sheet/model";
import { DEFAULT_SHEET_LIMITS } from "../src/sheet/model";
import { formatNumber } from "../src/sheet/numfmt";
import { readXlsx } from "../src/sheet/xlsx";

// import.meta.url is not a file: URL under happy-dom, so resolve from the module directory.
const SALES = resolve(import.meta.dirname, "../../../examples/sheet/sales.xlsx");

function cellAt(sheet: SheetModel, ref: string): Cell | undefined {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) throw new Error(ref);
  const col = [...(match[1] as string)].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  return sheet.cells.find((c) => c.row === row && c.col === col);
}

describe("readXlsx on examples/sheet/sales.xlsx", () => {
  const bytes = new Uint8Array(readFileSync(SALES));

  it("reads shared strings, cached formula results, number formats and styles", async () => {
    const wb = await readXlsx(ZipArchive.open(bytes), DEFAULT_SHEET_LIMITS);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Sales H1", "Notes"]);
    const sales = wb.sheets[0] as SheetModel;

    expect(cellAt(sales, "A1")?.text).toBe("SwarmLoom sales, first half 2026");
    expect(cellAt(sales, "A3")).toMatchObject({ text: "Region", kind: "string" });
    expect(cellAt(sales, "A3")?.style).toMatchObject({ bold: true, color: "#ffffff", fill: "#5b5bf7" });
    expect(cellAt(sales, "C4")).toMatchObject({ text: "120", kind: "number" });
    // Formula cells show the cached result, formatted with the cell's #,##0.
    expect(cellAt(sales, "I24")).toMatchObject({ text: "39,894", kind: "number" });
    expect(cellAt(sales, "C26")?.text).toBe("18.4%");
    expect(cellAt(sales, "C27")?.text).toBe("2026-07-01");
    expect(cellAt(sales, "C28")?.text).toBe("$24.50");
    expect(cellAt(wb.sheets[1] as SheetModel, "B2")?.text).toBe("14 Mar 2025");

    expect(sales.headerRow).toBe(2);
    expect(sales.merges).toContainEqual({ r0: 0, c0: 0, r1: 0, c1: 8 });
    expect(sales.merges).toContainEqual({ r0: 23, c0: 0, r1: 23, c1: 1 });
    expect(sales.cols).toBe(9);
    expect(sales.rows).toBe(28);
    // Column A is 14 characters wide; columns C-H are 9.
    expect(sales.colWidths[0]).toBeGreaterThan(sales.colWidths[2] as number);
    expect(sales.droppedCells).toBe(0);
  });

  it("applies row and column limits and counts what was cut", async () => {
    const wb = await readXlsx(ZipArchive.open(bytes), { maxRows: 5, maxCols: 3, maxSheets: 1 });
    expect(wb.sheets).toHaveLength(1);
    expect(wb.droppedSheets).toBe(1);
    const sales = wb.sheets[0] as SheetModel;
    expect(sales.rows).toBe(5);
    expect(sales.cols).toBe(3);
    expect(sales.usedRows).toBe(28);
    expect(sales.usedCols).toBe(9);
    expect(sales.droppedCells).toBeGreaterThan(100);
    expect(sales.cells.every((c) => c.row < 5 && c.col < 3)).toBe(true);
    // The A1:I1 title merge is clipped to the kept columns.
    expect(sales.merges).toContainEqual({ r0: 0, c0: 0, r1: 0, c1: 2 });
  });
});

describe("xlsx input validation", () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it("rejects a ZIP that is not a workbook", async () => {
    const zip = ZipArchive.open(zipSync({ "readme.txt": enc("hello") }));
    await expect(readXlsx(zip, DEFAULT_SHEET_LIMITS)).rejects.toBeInstanceOf(OfficeFormatError);
  });

  it("refuses XML with a DOCTYPE (entity expansion)", async () => {
    const zip = ZipArchive.open(
      zipSync({ "xl/workbook.xml": enc('<!DOCTYPE x [<!ENTITY a "aaaa">]><workbook xmlns="urn:x"/>') }),
    );
    await expect(readXlsx(zip, DEFAULT_SHEET_LIMITS)).rejects.toThrow(/DOCTYPE/);
  });

  it("drops archive entries whose names escape the package", () => {
    const zip = ZipArchive.open(zipSync({ "../evil.xml": enc("<x/>"), "ok.xml": enc("<x/>") }));
    expect(zip.names()).toEqual(["ok.xml"]);
  });
});

describe("formatNumber", () => {
  it.each<[number, string, string]>([
    [1234.5, "#,##0.00", "1,234.50"],
    [-1234.5, "#,##0.00", "-1,234.50"],
    [-5, '"$"#,##0', "-$5"],
    [-5, "#,##0;(#,##0)", "(5)"],
    [0.256, "0%", "26%"],
    [1234567, "0.00E+00", "1.23E+06"],
    [1500000, '#,##0.0,,"M"', "1.5M"],
    [45839, "yyyy-mm-dd", "2025-07-01"],
    [0.75, "h:mm AM/PM", "6:00 PM"],
    [1.5, "[h]:mm", "36:00"],
    [60, "m/d/yyyy", "2/29/1900"],
    [2.71, "General", "2.71"],
    [1 / 3, "General", "0.333333333"],
    [12, "@", "12"],
  ])("%d with %s", (value, code, expected) => {
    expect(formatNumber(value, code, false).trim()).toBe(expected);
  });
});
