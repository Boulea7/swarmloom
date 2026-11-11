import type { Fib, StoryLengths } from "./fib";
import { FcLcb } from "./fib";
import { readPlc } from "./plc";
import type { ByteReader } from "./reader";

/** A CP range [start, end) of the document text. */
export interface CpRange {
  start: number;
  end: number;
}

/** First CP of each story (MS-DOC 2.3.1: stories follow each other in this order). */
export function storyStarts(s: StoryLengths) {
  const footnotes = s.main;
  const headers = footnotes + s.footnotes;
  const comments = headers + s.headers + s.macros;
  const endnotes = comments + s.comments;
  return { main: 0, footnotes, headers, endnotes };
}

/** Header/footer stories of one section, already resolved through inheritance from previous sections. */
export interface SectionHeaders {
  header: CpRange | null;
  footer: CpRange | null;
  firstHeader: CpRange | null;
  firstFooter: CpRange | null;
}

const SEPARATOR_STORIES = 6;
const STORIES_PER_SECTION = 6;
const ODD_HEADER = 1;
const ODD_FOOTER = 3;
const FIRST_HEADER = 4;
const FIRST_FOOTER = 5;

/**
 * Reads PlcfHdd. Each section owns six stories (even/odd header, even/odd footer, first header/footer);
 * an empty story inherits the same story of the previous section.
 */
export function readHeaders(table: ByteReader, fib: Fib, sectionCount: number): SectionHeaders[] {
  const { fc, lcb } = fib.fcLcb(FcLcb.plcfHdd);
  const start = storyStarts(fib.stories).headers;
  const out: SectionHeaders[] = [];
  if (lcb < 8 || fib.stories.headers === 0) {
    for (let i = 0; i < sectionCount; i++)
      out.push({ header: null, footer: null, firstHeader: null, firstFooter: null });
    return out;
  }
  const plc = readPlc(table, fc, lcb, 0, "header table");
  const story = (index: number): CpRange | null => {
    if (index + 1 >= plc.pos.length) return null;
    const from = plc.pos[index];
    const to = Math.min(plc.pos[index + 1], fib.stories.headers);
    return to > from ? { start: start + from, end: start + to } : null;
  };
  let prev: SectionHeaders = { header: null, footer: null, firstHeader: null, firstFooter: null };
  for (let i = 0; i < sectionCount; i++) {
    const base = SEPARATOR_STORIES + i * STORIES_PER_SECTION;
    const current: SectionHeaders = {
      header: story(base + ODD_HEADER) ?? prev.header,
      footer: story(base + ODD_FOOTER) ?? prev.footer,
      firstHeader: story(base + FIRST_HEADER) ?? prev.firstHeader,
      firstFooter: story(base + FIRST_FOOTER) ?? prev.firstFooter,
    };
    out.push(current);
    prev = current;
  }
  return out;
}

/** A footnote or endnote: where its reference sits in the main story and where its text lives. */
export interface NoteRef {
  /** CP of the reference character in the main story. */
  refCp: number;
  /** Auto-numbered (the usual case) or a custom mark taken from the text. */
  auto: boolean;
  text: CpRange;
}

/** Reads the footnote or endnote reference and text PLCs. */
export function readNotes(table: ByteReader, fib: Fib, kind: "footnote" | "endnote"): NoteRef[] {
  const refIndex = kind === "footnote" ? FcLcb.plcffndRef : FcLcb.plcfendRef;
  const txtIndex = kind === "footnote" ? FcLcb.plcffndTxt : FcLcb.plcfendTxt;
  const length = kind === "footnote" ? fib.stories.footnotes : fib.stories.endnotes;
  const ref = fib.fcLcb(refIndex);
  const txt = fib.fcLcb(txtIndex);
  if (ref.lcb === 0 || txt.lcb === 0 || length === 0) return [];
  const starts = storyStarts(fib.stories);
  const storyStart = kind === "footnote" ? starts.footnotes : starts.endnotes;
  const refs = readPlc(table, ref.fc, ref.lcb, 2, `${kind} references`);
  const texts = readPlc(table, txt.fc, txt.lcb, 0, `${kind} texts`);
  const notes: NoteRef[] = [];
  for (let i = 0; i < refs.count && i + 1 < texts.pos.length; i++) {
    const from = Math.min(texts.pos[i], length);
    const to = Math.min(texts.pos[i + 1], length);
    notes.push({
      refCp: refs.pos[i],
      auto: table.i16(refs.dataOffset + i * 2) > 0,
      text: { start: storyStart + from, end: storyStart + to },
    });
  }
  return notes;
}
