import type { CharProps, ParaProps } from "./parser/props";
import type { SectionProps } from "./parser/sections";

export type { Align, CharProps, ParaProps } from "./parser/props";
export type { SectionProps } from "./parser/sections";

/** A stretch of text with uniform formatting. `text` may contain "\n" (line breaks) and "\t". */
export interface DocTextRun {
  kind: "text";
  text: string;
  props: CharProps;
  /** Absolute http(s)/mailto URL from a HYPERLINK field. */
  href?: string;
}

/** Footnote/endnote reference mark. `index` points into `DocModel.footnotes` / `DocModel.endnotes`. */
export interface DocNoteRun {
  kind: "note";
  note: "footnote" | "endnote";
  index: number;
  mark: string;
  props: CharProps;
}

/** Inline picture extracted from the Data stream. Size in twips. */
export interface DocImageRun {
  kind: "image";
  src: string;
  width: number;
  height: number;
}

/** Explicit page break (Ctrl+Enter) inside a paragraph. */
export interface DocPageBreakRun {
  kind: "page-break";
}

export type DocRun = DocTextRun | DocNoteRun | DocImageRun | DocPageBreakRun;

export interface DocParagraph {
  kind: "paragraph";
  runs: DocRun[];
  props: ParaProps;
  /** Formatting of the paragraph mark (drives the height of empty paragraphs). */
  mark: CharProps;
  style: string;
  /** 1..9 for headings (built-in heading styles or outline levels), 0 otherwise. */
  heading: number;
  /** The built-in Title style. */
  title: boolean;
  /** Rendered list marker ("1.", "a)", a bullet), when the paragraph is a list item. */
  marker?: string;
  /** Separator after the marker. */
  markerFollow?: "tab" | "space" | "none";
}

export interface DocTableCell {
  blocks: DocBlock[];
}

export interface DocTableRow {
  cells: DocTableCell[];
  /** Column edges in twips from the row definition, when present. */
  columns: number[] | null;
  borders: boolean | null;
}

export interface DocTable {
  kind: "table";
  rows: DocTableRow[];
}

export type DocBlock = DocParagraph | DocTable;

export interface DocSection {
  props: SectionProps;
  blocks: DocBlock[];
  header: DocBlock[];
  footer: DocBlock[];
  firstHeader: DocBlock[];
  firstFooter: DocBlock[];
}

export interface DocNote {
  mark: string;
  blocks: DocBlock[];
}

export interface DocFont {
  name: string;
  generic: "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy" | null;
}

/** Everything the converter recovered from a Word 97-2003 file. */
export interface DocModel {
  sections: DocSection[];
  footnotes: DocNote[];
  endnotes: DocNote[];
  fonts: DocFont[];
  stats: { paragraphs: number; tables: number; images: number; characters: number };
  /** Human-readable notes about content that was skipped or approximated. */
  warnings: string[];
}
