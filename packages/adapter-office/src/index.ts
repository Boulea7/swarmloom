import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";

/**
 * Slides (PPTX; legacy PPT and ODP when supported) -> one stage section per slide -> snapshot-dom.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const slidesAdapter: Adapter = {
  id: "slides",
  label: "Presentation",
  extensions: ["pptx", "ppt", "odp"],
  mime: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.presentation",
  ],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};

/**
 * Spreadsheets (XLSX/XLS/ODS/CSV/TSV) -> grid of cells filled row by row.
 *
 * Stub: `load()` rejects until the implementation lands.
 */
export const sheetAdapter: Adapter = {
  id: "sheet",
  label: "Spreadsheet",
  extensions: ["xlsx", "xlsm", "xls", "ods", "csv", "tsv"],
  mime: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.spreadsheet",
    "text/csv",
    "text/tab-separated-values",
  ],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    void input;
    void ctx;
    throw new Error("not implemented yet");
  },
};
