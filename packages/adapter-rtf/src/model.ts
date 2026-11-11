/** Document model produced by {@link parseRtf}. Lengths are in twips (1/1440 inch) unless noted. */

/** Character formatting of a run. */
export interface RtfCharStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Font size in half-points (24 = 12 pt). */
  size: number;
  /** Font table entry, when the run names one. */
  font?: RtfFont;
  /** CSS colour from the colour table. */
  color?: string;
  /** CSS background colour (`\highlight` or `\cb`). */
  background?: string;
  vertical?: "super" | "sub";
  caps?: "all" | "small";
}

/** A font table entry. */
export interface RtfFont {
  id: number;
  name: string;
  /** From `\froman`, `\fswiss`, `\fmodern`... */
  generic?: "serif" | "sans-serif" | "monospace";
  charset: number;
  /** Code page used to decode `\'hh` bytes in this font. */
  codepage: number;
}

/** Inline content of a paragraph. */
export type RtfRun =
  | { type: "text"; text: string; style: RtfCharStyle }
  | { type: "break" }
  | { type: "tab" }
  | { type: "image"; mime: "image/png" | "image/jpeg"; bytes: Uint8Array; width?: number; height?: number }
  | { type: "unsupported-image"; format: string; width?: number; height?: number };

/** A paragraph and its formatting. */
export interface RtfParagraph {
  type: "paragraph";
  align: "left" | "center" | "right" | "justify";
  leftIndent: number;
  rightIndent: number;
  firstIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  /** `\sl`: positive is "at least", negative "exactly"; with `lineMultiple` it is 240ths of a line. */
  lineSpacing?: number;
  lineMultiple?: boolean;
  /** Size of the paragraph mark (half-points): the height of an empty paragraph. */
  markSize: number;
  runs: RtfRun[];
}

/** A table cell: its right edge (`\cellx`), shading, merge flags and paragraphs. */
export interface RtfCell {
  right: number;
  background?: string;
  /** First cell of a vertical merge (`\clvmgf`) or a continuation (`\clvmrg`). */
  verticalMerge?: "first" | "continue";
  /** Continuation of a horizontal merge (`\clmrg`). */
  mergedLeft?: boolean;
  paragraphs: RtfParagraph[];
}

/** A table row. */
export interface RtfRow {
  left: number;
  bordered: boolean;
  cells: RtfCell[];
}

/** Consecutive rows. */
export interface RtfTable {
  type: "table";
  rows: RtfRow[];
}

/** Block content. */
export type RtfBlock = RtfParagraph | RtfTable | { type: "page-break" };

/** Content the parser met but does not render, for quality notes. */
export interface RtfStats {
  /** Headers and footers (skipped). */
  headers: number;
  /** Footnotes, endnotes and comments (skipped). */
  footnotes: number;
  /** Pictures in formats a browser cannot show (EMF, WMF, DIB...). */
  unsupportedPictures: number;
  /** Pictures over the size limits. */
  droppedPictures: number;
  /** Nested tables, flattened into their outer cell. */
  nestedTables: number;
}

/** A parsed RTF document. */
export interface RtfDocument {
  title?: string;
  author?: string;
  /** Document code page (`\ansicpg`, `\mac`, `\pc`...). */
  codepage: number;
  /** Default font (`\deff`). */
  defaultFont?: RtfFont;
  /** Default tab width (`\deftab`). */
  defaultTab: number;
  page: { width: number; height: number; top: number; right: number; bottom: number; left: number };
  fonts: Map<number, RtfFont>;
  colors: (string | undefined)[];
  blocks: RtfBlock[];
  stats: RtfStats;
}
