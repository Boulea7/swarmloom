import { DocError } from "../errors";
import type { DocBlock, DocModel, DocNote, DocSection } from "../model";
import { assembleBlocks, trimTrailingEmpty } from "./blocks";
import { openWordStreams } from "./container";
import { FcLcb, readFib } from "./fib";
import { type FkpRun, readFkpRuns } from "./fkp";
import { readFonts } from "./fonts";
import { Formatter } from "./format";
import { formatNumber, type Lists, readLists } from "./lists";
import { createPictureResolver } from "./pictures";
import { readPieceTable } from "./pieces";
import { readSections, type SectionProps } from "./sections";
import { type CpRange, readHeaders, readNotes, type SectionHeaders } from "./stories";
import { emptyStyles, readStyles, type StyleSheet } from "./styles";
import { type NoteMark, type WalkContext, type WalkedParagraph, walkStory } from "./walk";

/** Input size cap: Word 97-2003 files beyond this are almost always image-heavy and better converted. */
export const MAX_DOC_BYTES = 64 * 1024 * 1024;

export interface ParseDocOptions {
  /** Extract inline PNG/JPEG pictures as data URLs (default true). */
  pictures?: boolean;
}

/**
 * Parses a Word 97-2003 (.doc) file into a {@link DocModel}.
 *
 * Text, paragraphs, tables, headers/footers and notes always come from the piece table; formatting
 * (styles, fonts, lists, sections, pictures) is best effort: when a formatting table is damaged the
 * document still opens with plain text and a warning.
 *
 * @throws DocError for non-Word input, encrypted or pre-97 files and a damaged piece table.
 */
export function parseDoc(bytes: Uint8Array, options: ParseDocOptions = {}): DocModel {
  if (bytes.length === 0) throw new DocError("no-input");
  if (bytes.length > MAX_DOC_BYTES) throw new DocError("too-large", `${bytes.length} bytes`);
  const streams = openWordStreams(bytes);
  const fib = readFib(streams.word);
  const table = streams.table(fib.table);
  const pieces = readPieceTable(streams.word, table, fib);
  const warnings: string[] = [];
  const optional = <T>(what: string, fallback: T, read: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (!(error instanceof DocError)) throw error;
      warnings.push(`${what} could not be read; it was skipped.`);
      return fallback;
    }
  };

  if (fib.complex) warnings.push("The document was fast-saved; some formatting may be missing.");
  const styles: StyleSheet = optional("The style sheet", emptyStyles(), () => readStyles(table, fib));
  const papx = optional<FkpRun[]>("Paragraph formatting", [], () =>
    readFkpRuns(streams.word, table, fib, FcLcb.plcfBtePapx, "papx"),
  );
  const chpx = optional<FkpRun[]>("Character formatting", [], () =>
    readFkpRuns(streams.word, table, fib, FcLcb.plcfBteChpx, "chpx"),
  );
  const lists = optional<Lists | null>("List numbering", null, () => readLists(table, fib));
  const fonts = optional("The font table", [], () => readFonts(table, fib));
  const sections = optional<SectionProps[]>("Section layout", [], () => readSections(streams.word, table, fib));
  if (sections.length === 0) sections.push(fallbackSection(fib.stories.main));
  const headers = optional<SectionHeaders[]>("Headers and footers", [], () => readHeaders(table, fib, sections.length));
  const footnoteRefs = optional("Footnotes", [], () => readNotes(table, fib, "footnote"));
  const endnoteRefs = optional("Endnotes", [], () => readNotes(table, fib, "endnote"));

  const notes = new Map<number, NoteMark>();
  footnoteRefs.forEach((n, i) => {
    notes.set(n.refCp, { note: "footnote", index: i, mark: noteMark(pieces.text, n.refCp, n.auto, i + 1, 0) });
  });
  endnoteRefs.forEach((n, i) => {
    notes.set(n.refCp, { note: "endnote", index: i, mark: noteMark(pieces.text, n.refCp, n.auto, i + 1, 2) });
  });

  const ctx: WalkContext = {
    text: pieces.text,
    format: new Formatter(pieces, papx, chpx, styles, lists),
    lists,
    sectionMarks: new Set(sections.slice(0, -1).map((s) => s.cpEnd - 1)),
    notes,
    picture: options.pictures === false ? () => null : createPictureResolver(streams.data),
    skipped: { pictures: 0, objects: 0, shapes: 0 },
  };

  const main = walkStory(ctx, { start: 0, end: Math.min(fib.stories.main, pieces.text.length) });
  const story = (range: CpRange | null): DocBlock[] =>
    range ? trimTrailingEmpty(assembleBlocks(walkStory(ctx, clampRange(range, pieces.text.length)))) : [];
  const docSections = splitSections(main, sections).map((blocks, i): DocSection => {
    const h = headers[i];
    return {
      props: sections[i]!,
      blocks,
      header: story(h?.header ?? null),
      footer: story(h?.footer ?? null),
      firstHeader: story(h?.firstHeader ?? null),
      firstFooter: story(h?.firstFooter ?? null),
    };
  });
  const toNotes = (refs: typeof footnoteRefs): DocNote[] =>
    refs.map((n, i) => ({ mark: notes.get(n.refCp)?.mark ?? String(i + 1), blocks: story(n.text) }));

  if (ctx.skipped.pictures > 0)
    warnings.push(`${ctx.skipped.pictures} picture(s) in an unsupported format were skipped.`);
  if (ctx.skipped.objects > 0) warnings.push(`${ctx.skipped.objects} embedded object(s) are not shown.`);
  if (ctx.skipped.shapes > 0) warnings.push(`${ctx.skipped.shapes} floating shape(s) or picture(s) are not shown.`);
  if (fib.stories.textboxes > 0 || fib.stories.headerTextboxes > 0) warnings.push("Text boxes are not shown.");
  if (fib.stories.comments > 0) warnings.push("Comments are not shown.");

  const images = countImages(docSections);
  return {
    sections: docSections,
    footnotes: toNotes(footnoteRefs),
    endnotes: toNotes(endnoteRefs),
    fonts,
    stats: {
      paragraphs: main.length,
      tables: docSections.reduce((n, s) => n + s.blocks.filter((b) => b.kind === "table").length, 0),
      images,
      characters: fib.stories.main,
    },
    warnings,
  };
}

function fallbackSection(end: number): SectionProps {
  return {
    cpStart: 0,
    cpEnd: end,
    breakCode: 2,
    pageWidth: 12240,
    pageHeight: 15840,
    marginLeft: 1800,
    marginRight: 1800,
    marginTop: 1440,
    marginBottom: 1440,
    headerTop: 720,
    footerBottom: 720,
    titlePage: false,
  };
}

function clampRange(range: CpRange, length: number): CpRange {
  return { start: Math.min(range.start, length), end: Math.min(range.end, length) };
}

/** Footnotes count 1, 2, 3; endnotes use Word's default i, ii, iii. Custom marks are the literal reference text. */
function noteMark(text: string, cp: number, auto: boolean, n: number, nfc: number): string {
  if (!auto) {
    const literal = text[cp] ?? "";
    if (literal && literal.charCodeAt(0) >= 0x20) return literal;
  }
  return formatNumber(n, nfc);
}

/** Assigns main-story paragraphs to sections by their first CP, then groups each section's paragraphs into blocks. */
function splitSections(paragraphs: WalkedParagraph[], sections: SectionProps[]): DocBlock[][] {
  const groups: WalkedParagraph[][] = sections.map(() => []);
  let s = 0;
  for (const p of paragraphs) {
    while (s < sections.length - 1 && p.cpStart >= sections[s]!.cpEnd) s++;
    groups[s]!.push(p);
  }
  return groups.map(assembleBlocks);
}

function countImages(sections: DocSection[]): number {
  let n = 0;
  const visit = (blocks: DocBlock[]) => {
    for (const b of blocks) {
      if (b.kind === "table") for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks);
      else for (const r of b.runs) if (r.kind === "image") n++;
    }
  };
  for (const s of sections) visit(s.blocks);
  return n;
}
