/**
 * User-facing quality notes for a converted workbook: formulas shown without a saved result,
 * drawings that are not rebuilt and fonts that are substituted.
 */

import { FontLog } from "../shared/fonts";
import type { ZipArchive } from "../shared/zip";
import type { WorkbookModel } from "./model";

/** What the notes are built from besides the model. */
export interface SheetNoteSource {
  /** Package the workbook came from (absent for CSV/TSV, which declare no fonts or drawings). */
  zip?: ZipArchive;
}

/** Part-name prefixes of charts and pictures in XLSX and ODS packages. */
const DRAWING_PARTS = ["xl/drawings/", "xl/charts/", "xl/media/", "Pictures/", "Object "];

/**
 * Builds the notes for `OfficeLoadedSource.notes` (empty when the workbook converted fully).
 * `doc` is the document the sheets are shown in; fonts it can draw are not reported.
 */
export function sheetNotes(wb: WorkbookModel, source: SheetNoteSource, doc: Document): string[] {
  const notes: string[] = [];
  let formulas = 0;
  const fonts = new FontLog();
  for (const sheet of wb.sheets) {
    for (const cell of sheet.cells) {
      if (cell.kind === "formula") formulas++;
      if (source.zip && /\S/.test(cell.text)) fonts.add(cell.style?.font ?? sheet.font);
    }
  }
  if (formulas > 0) {
    notes.push(
      `${formulas} formula${formulas > 1 ? "s have" : " has"} no saved result and ${formulas > 1 ? "are" : "is"} shown as formula text. Open and save the file in a spreadsheet app to store the results.`,
    );
  }
  if (source.zip?.names().some((name) => DRAWING_PARTS.some((prefix) => name.startsWith(prefix)))) {
    notes.push("Charts, pictures and embedded objects in the workbook are not shown.");
  }
  const fontNote = fonts.note(doc);
  if (fontNote) notes.push(fontNote);
  return notes;
}
