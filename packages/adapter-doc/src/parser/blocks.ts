import type { DocBlock, DocParagraph, DocTable, DocTableCell, DocTableRow } from "../model";
import type { WalkedParagraph } from "./walk";

/** Strips walker bookkeeping from a paragraph. */
export function toParagraph(p: WalkedParagraph): DocParagraph {
  const { terminator: _t, cpStart: _c, ...paragraph } = p;
  return paragraph;
}

/**
 * Groups walked paragraphs into blocks: consecutive in-table paragraphs become a table whose cells end at
 * cell marks and rows at row marks. Nested tables are flattened into their outer cell.
 */
export function assembleBlocks(paragraphs: readonly WalkedParagraph[]): DocBlock[] {
  const blocks: DocBlock[] = [];
  let table: DocTable | null = null;
  let cells: DocTableCell[] = [];
  let cell: DocBlock[] = [];

  const closeTable = () => {
    if (!table) return;
    if (cell.length > 0) cells.push({ blocks: cell });
    if (cells.length > 0) table.rows.push({ cells, columns: null, borders: null });
    if (table.rows.length > 0) blocks.push(table);
    table = null;
    cells = [];
    cell = [];
  };

  for (const p of paragraphs) {
    if (!p.props.inTable) {
      closeTable();
      blocks.push(toParagraph(p));
      continue;
    }
    table ??= { kind: "table", rows: [] };
    if (p.terminator === "row") {
      if (cell.length > 0) cells.push({ blocks: cell });
      const row: DocTableRow = { cells, columns: p.props.columns, borders: p.props.borders };
      (table as DocTable).rows.push(row);
      cells = [];
      cell = [];
      continue;
    }
    cell.push(toParagraph(p));
    if (p.terminator === "cell") {
      cells.push({ blocks: cell });
      cell = [];
    }
  }
  closeTable();
  return blocks;
}

/** Removes trailing empty paragraphs (headers, footers and notes end with spare paragraph marks). */
export function trimTrailingEmpty(blocks: DocBlock[]): DocBlock[] {
  let end = blocks.length;
  while (end > 0) {
    const last = blocks[end - 1]!;
    if (last.kind !== "paragraph" || !isEmptyParagraph(last)) break;
    end--;
  }
  return blocks.slice(0, end);
}

export function isEmptyParagraph(p: DocParagraph): boolean {
  return !p.marker && p.runs.every((r) => r.kind === "text" && r.text.trim() === "");
}
