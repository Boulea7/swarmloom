import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { FontLog, fontStack } from "../src/shared/fonts";
import { ZipArchive } from "../src/shared/zip";
import type { SheetModel, WorkbookModel } from "../src/sheet/model";
import { sheetNotes } from "../src/sheet/notes";

/** A document whose canvas draws the `installed` faces wider than the generic families. */
function fakeDocument(...installed: string[]): Document {
  const ctx = {
    font: "",
    measureText(): { width: number } {
      const names = this.font
        .replace(/^\d+px /, "")
        .replace(/"/g, "")
        .split(", ");
      return { width: names.some((name) => installed.includes(name)) ? 120 : 100 };
    },
  };
  return { createElement: () => ({ getContext: () => ctx }) } as unknown as Document;
}

describe("font substitutes (decisions F01)", () => {
  it.each([
    ["Calibri", /^Calibri, Carlito, .*, sans-serif$/],
    ["Cambria", /^Cambria, Caladea, .*, serif$/],
    ["宋体", /^"宋体", SimSun, "Noto Serif SC", .*, serif$/],
    ["Microsoft YaHei", /^"Microsoft YaHei", "Noto Sans SC", .*, sans-serif$/],
  ])("stacks %s with its open substitute from the core table", (face, stack) => {
    expect(fontStack(face)).toMatch(stack);
  });

  it("reports each missing substituted face once, in first-use order, and skips faces without one", () => {
    const log = new FontLog();
    for (const face of ["Calibri", "Segoe UI", "Cambria", "Inter", "calibri", "微软雅黑", undefined, " "])
      log.add(face);
    // Cambria is installed, so it is shown as is and not reported.
    expect(log.substitutions(fakeDocument("Cambria"))).toEqual(["Calibri → Carlito", "微软雅黑 → Noto Sans SC"]);
    // 微软雅黑 counts as installed under its English name.
    expect(log.note(fakeDocument("Calibri", "Cambria", "Microsoft YaHei"))).toBeUndefined();
    expect(new FontLog().note(fakeDocument())).toBeUndefined();
  });
});

function sheet(cells: SheetModel["cells"]): SheetModel {
  return {
    name: "S",
    cells,
    rows: 2,
    cols: 2,
    colWidths: [64, 64],
    rowHeights: [20, 20],
    merges: [],
    showGrid: true,
    fontSize: 11,
    font: "Calibri",
    droppedCells: 0,
    usedRows: 2,
    usedCols: 2,
  };
}

describe("sheetNotes", () => {
  const wb: WorkbookModel = {
    sheets: [
      sheet([
        { row: 0, col: 0, text: "=SUM(A2:A9)", kind: "formula" },
        { row: 0, col: 1, text: "Total", kind: "string", style: { font: "Arial" } },
        { row: 1, col: 0, text: "", kind: "string", style: { font: "Cambria" } },
      ]),
    ],
    droppedSheets: 0,
  };

  it("lists formulas without results, drawings and the fonts of non-empty cells", () => {
    const zip = ZipArchive.open(
      zipSync({ "xl/workbook.xml": new Uint8Array(1), "xl/charts/chart1.xml": new Uint8Array(1) }),
    );
    const notes = sheetNotes(wb, { zip }, fakeDocument());
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/^1 formula has no saved result/);
    expect(notes[1]).toMatch(/Charts, pictures/);
    expect(notes[2]).toMatch(/Calibri → Carlito, Arial → Liberation Sans\.$/);
  });

  it("reports no fonts for delimited text", () => {
    expect(sheetNotes(wb, {}, fakeDocument())).toEqual([expect.stringMatching(/formula/)]);
  });
});
