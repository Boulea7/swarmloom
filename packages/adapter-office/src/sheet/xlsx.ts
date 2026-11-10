import { OfficeFormatError, throwIfAborted, yieldToEventLoop } from "../shared/errors";
import { readRels, relOfType } from "../shared/opc";
import { attr, boolAttr, intAttr, kid, kids, nsAttr, numAttr, parseXml, readXml } from "../shared/xml";
import type { ZipArchive } from "../shared/zip";
import {
  type Cell,
  type CellKind,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  detectHeaderRow,
  type Merge,
  parseRange,
  parseRef,
  type SheetLimits,
  type SheetModel,
  type WorkbookModel,
} from "./model";
import { formatNumber } from "./numfmt";
import { Stylesheet, themePalette } from "./styles";

/** Excel's maximum digit width for Calibri 11 at 96 dpi, px per character of column width. */
const DIGIT_PX = 7;
const PT_TO_PX = 96 / 72;

/** Decodes SpreadsheetML `_xHHHH_` escapes (control characters stored in strings). */
function unescapeOoxml(text: string): string {
  return text.includes("_x")
    ? text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    : text;
}

/** Plain text of a CT_Rst (shared or inline string): `t`, or the concatenated runs; phonetic runs skipped. */
function richText(el: Element | undefined): string {
  if (!el) return "";
  const t = kid(el, "t");
  if (t) return unescapeOoxml(t.textContent ?? "");
  let out = "";
  for (const r of kids(el, "r")) out += kid(r, "t")?.textContent ?? "";
  return unescapeOoxml(out);
}

interface SheetRef {
  name: string;
  part: string;
}

interface WorkbookParts {
  sheets: SheetRef[];
  /** Visible worksheets that are not readable (chart sheets, macro sheets). */
  skipped: number;
  date1904: boolean;
  strings: string[];
  styles: Stylesheet;
}

function openWorkbook(zip: ZipArchive): WorkbookParts {
  const officeDoc = relOfType(readRels(zip, ""), "officeDocument");
  const part = officeDoc && !officeDoc.external ? officeDoc.target : "xl/workbook.xml";
  const workbook = readXml(zip, part);
  if (workbook?.localName !== "workbook") {
    throw new OfficeFormatError("This file is not an Excel (.xlsx) workbook");
  }
  const rels = readRels(zip, part);
  const target = (type: string): string | undefined => {
    const rel = relOfType(rels, type);
    return rel && !rel.external ? rel.target : undefined;
  };
  const themePart = target("theme");
  const palette = themePalette(themePart ? readXml(zip, themePart) : undefined);
  const stylesPart = target("styles");
  const styles = new Stylesheet(stylesPart ? readXml(zip, stylesPart) : undefined, palette);
  const stringsPart = target("sharedStrings");
  const sst = stringsPart ? readXml(zip, stringsPart) : undefined;
  const strings = kids(sst, "si").map(richText);

  const sheets: SheetRef[] = [];
  let skipped = 0;
  for (const sheet of kids(kid(workbook, "sheets"), "sheet")) {
    const state = attr(sheet, "state");
    if (state === "hidden" || state === "veryHidden") continue;
    const rel = rels.get(nsAttr(sheet, "id") ?? "");
    if (!rel || rel.external || rel.type !== "worksheet" || !zip.has(rel.target)) {
      skipped++;
      continue;
    }
    sheets.push({ name: attr(sheet, "name") ?? `Sheet${sheets.length + 1}`, part: rel.target });
  }
  return {
    sheets,
    skipped,
    date1904: boolAttr(kid(workbook, "workbookPr"), "date1904", false),
    strings,
    styles,
  };
}

const ROW_TAG = /<(?:[\w.-]+:)?row\b([^>]*)>/g;
const VALUE_TAG = /<(?:[\w.-]+:)?(?:v|is)[\s>]/g;

/**
 * Cuts `<sheetData>` after `maxRows` rows before DOM parsing, so a million-row sheet never
 * becomes a million-node DOM. Returns the trimmed XML and the number of values cut away.
 * Safe because markup cannot appear unescaped inside text content.
 */
export function trimSheetXml(xml: string, maxRows: number): { xml: string; droppedValues: number } {
  const start = xml.indexOf("sheetData");
  if (start < 0) return { xml, droppedValues: 0 };
  const close = /<\/(?:[\w.-]+:)?sheetData>/.exec(xml.slice(start));
  if (!close) return { xml, droppedValues: 0 };
  const dataEnd = start + close.index;
  ROW_TAG.lastIndex = start;
  let ordinal = 0;
  let cut = -1;
  for (let m = ROW_TAG.exec(xml); m && m.index < dataEnd; m = ROW_TAG.exec(xml)) {
    const r = /\br="(\d+)"/.exec(m[1] ?? "");
    ordinal = r?.[1] ? Number(r[1]) : ordinal + 1;
    if (ordinal > maxRows) {
      cut = m.index;
      break;
    }
  }
  if (cut < 0) return { xml, droppedValues: 0 };
  const rest = xml.slice(cut, dataEnd);
  const droppedValues = rest.match(VALUE_TAG)?.length ?? 0;
  return { xml: xml.slice(0, cut) + xml.slice(dataEnd), droppedValues };
}

/** Column width in characters -> px (ECMA-376 Part 1, 18.3.1.13). */
function widthToPx(width: number): number {
  return Math.max(0, Math.round(width * DIGIT_PX));
}

interface CellValue {
  text: string;
  kind: CellKind;
}

function cellValue(c: Element, wb: WorkbookParts, s: number): CellValue | undefined {
  const type = attr(c, "t") ?? "n";
  const v = kid(c, "v")?.textContent ?? undefined;
  const f = kid(c, "f");
  switch (type) {
    case "s": {
      const index = v === undefined ? Number.NaN : Number(v);
      return { text: wb.strings[index] ?? "", kind: "string" };
    }
    case "inlineStr":
      return { text: richText(kid(c, "is")), kind: "string" };
    case "str":
      return { text: unescapeOoxml(v ?? ""), kind: "string" };
    case "b":
      return v === undefined ? undefined : { text: v === "1" || v === "true" ? "TRUE" : "FALSE", kind: "boolean" };
    case "e":
      return { text: v ?? "#N/A", kind: "error" };
    case "d":
      // ISO 8601 date cells (rare, strict files): show the date/time as written.
      return v ? { text: v.replace("T00:00:00", "").replace(/Z$/, ""), kind: "number" } : undefined;
    default: {
      if (v === undefined || v.trim() === "") {
        // A formula without a cached result: show the formula itself, never evaluate it.
        const formula = f?.textContent?.trim();
        return formula ? { text: `=${formula}`, kind: "formula" } : undefined;
      }
      const num = Number(v);
      if (!Number.isFinite(num)) return { text: v, kind: "string" };
      return { text: formatNumber(num, wb.styles.formatCode(s), wb.date1904).trimEnd(), kind: "number" };
    }
  }
}

function readSheet(ref: SheetRef, zip: ZipArchive, wb: WorkbookParts, limits: SheetLimits): SheetModel {
  const trimmed = trimSheetXml(zip.readText(ref.part), limits.maxRows);
  const root = parseXml(trimmed.xml, ref.part);
  const format = kid(root, "sheetFormatPr");
  const baseCol = numAttr(format, "baseColWidth");
  const defaultColWidth =
    numAttr(format, "defaultColWidth") !== undefined
      ? widthToPx(numAttr(format, "defaultColWidth", 0))
      : baseCol !== undefined
        ? Math.round((baseCol + 0.43) * DIGIT_PX + 5)
        : DEFAULT_COL_WIDTH;
  const defaultRowHeight = Math.round(numAttr(format, "defaultRowHeight", 15) * PT_TO_PX) || DEFAULT_ROW_HEIGHT;

  const cells: Cell[] = [];
  const rowHeights = new Map<number, number>();
  let droppedCells = trimmed.droppedValues;
  let lastRow = -1;
  let lastCol = -1;
  let usedRows = 0;
  let usedCols = 0;
  let rowIndex = -1;
  for (const row of kids(kid(root, "sheetData"), "row")) {
    rowIndex = intAttr(row, "r", rowIndex + 2) - 1;
    if (rowIndex < 0) continue;
    if (rowIndex >= limits.maxRows) {
      droppedCells += row.getElementsByTagName("v").length;
      continue;
    }
    if (boolAttr(row, "hidden", false)) rowHeights.set(rowIndex, 0);
    else {
      const ht = numAttr(row, "ht");
      if (ht !== undefined) rowHeights.set(rowIndex, Math.round(ht * PT_TO_PX));
    }
    const rowStyle = boolAttr(row, "customFormat", false) ? intAttr(row, "s") : undefined;
    let colIndex = -1;
    for (const c of kids(row, "c")) {
      const pos = parseRef(attr(c, "r") ?? "");
      colIndex = pos ? pos.col : colIndex + 1;
      const s = intAttr(c, "s") ?? rowStyle ?? 0;
      const value = cellValue(c, wb, s);
      const style = wb.styles.style(s);
      const visible = value !== undefined && value.text !== "";
      if (visible) {
        usedRows = Math.max(usedRows, rowIndex + 1);
        usedCols = Math.max(usedCols, colIndex + 1);
      }
      if (colIndex >= limits.maxCols) {
        if (visible) droppedCells++;
        continue;
      }
      // Empty cells only matter when they paint something (fill or borders).
      if (!visible && !style?.fill && !style?.borders) continue;
      cells.push({ row: rowIndex, col: colIndex, text: value?.text ?? "", kind: value?.kind ?? "string", style });
      lastRow = Math.max(lastRow, rowIndex);
      lastCol = Math.max(lastCol, colIndex);
    }
  }

  const merges: Merge[] = [];
  for (const mc of kids(kid(root, "mergeCells"), "mergeCell")) {
    const range = parseRange(attr(mc, "ref") ?? "");
    if (!range || range.r0 >= limits.maxRows || range.c0 >= limits.maxCols) continue;
    if (range.r0 === range.r1 && range.c0 === range.c1) continue;
    const clipped = {
      ...range,
      r1: Math.min(range.r1, limits.maxRows - 1),
      c1: Math.min(range.c1, limits.maxCols - 1),
    };
    merges.push(clipped);
    lastRow = Math.max(lastRow, clipped.r1);
    lastCol = Math.max(lastCol, clipped.c1);
  }

  const rows = Math.min(limits.maxRows, lastRow + 1);
  const cols = Math.min(limits.maxCols, lastCol + 1);
  const colWidths = new Array<number>(Math.max(0, cols)).fill(defaultColWidth);
  for (const col of kids(kid(root, "cols"), "col")) {
    const min = intAttr(col, "min", 1) - 1;
    const max = Math.min(intAttr(col, "max", min + 1) - 1, cols - 1);
    const width = boolAttr(col, "hidden", false) ? 0 : widthToPx(numAttr(col, "width", defaultColWidth / DIGIT_PX));
    for (let i = Math.max(0, min); i <= max; i++) colWidths[i] = width;
  }
  const heights = Array.from({ length: Math.max(0, rows) }, (_, r) => rowHeights.get(r) ?? defaultRowHeight);
  const view = kid(kid(root, "sheetViews"), "sheetView");
  const dimension = parseRange(attr(kid(root, "dimension"), "ref") ?? "");
  return {
    name: ref.name,
    cells,
    rows,
    cols,
    colWidths,
    rowHeights: heights,
    merges,
    showGrid: boolAttr(view, "showGridLines", true),
    fontSize: wb.styles.fontSize,
    font: wb.styles.fontName,
    droppedCells,
    usedRows: Math.max(usedRows, dimension ? dimension.r1 + 1 : 0),
    usedCols: Math.max(usedCols, dimension ? dimension.c1 + 1 : 0),
    headerRow: detectHeaderRow(cells),
  };
}

/**
 * Reads the visible worksheets of an XLSX/XLSM package: shared strings, cell formats (fonts,
 * fills, borders, alignment, number formats), merged ranges, column widths and row heights.
 * Formulas are never evaluated: the cached result is shown, or the formula text when absent.
 */
export async function readXlsx(zip: ZipArchive, limits: SheetLimits, signal?: AbortSignal): Promise<WorkbookModel> {
  const wb = openWorkbook(zip);
  if (wb.sheets.length === 0) {
    throw new OfficeFormatError(
      wb.skipped > 0
        ? "The workbook has no worksheets that can be shown (only charts or macros)"
        : "The workbook has no visible worksheets",
    );
  }
  const sheets: SheetModel[] = [];
  for (const ref of wb.sheets.slice(0, limits.maxSheets)) {
    throwIfAborted(signal);
    sheets.push(readSheet(ref, zip, wb, limits));
    await yieldToEventLoop();
  }
  return { sheets, droppedSheets: Math.max(0, wb.sheets.length - limits.maxSheets) };
}
