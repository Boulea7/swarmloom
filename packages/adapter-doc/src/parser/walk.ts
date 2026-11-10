import type { DocParagraph, DocRun, DocTextRun } from "../model";
import type { Formatter } from "./format";
import type { Lists } from "./lists";
import type { CharProps } from "./props";
import type { CpRange } from "./stories";
import { Sti } from "./styles";

/** How a paragraph ended: normal mark, table cell mark, table row mark, or section mark. */
export type Terminator = "paragraph" | "cell" | "row" | "section";

export interface WalkedParagraph extends DocParagraph {
  terminator: Terminator;
  /** CP of the first character, used to assign paragraphs to sections. */
  cpStart: number;
}

export interface NoteMark {
  note: "footnote" | "endnote";
  index: number;
  mark: string;
}

/** Inline pictures: returns a run for the picture at a Data stream offset, or null when it cannot be shown. */
export type PictureResolver = (offset: number) => DocRun | null;

export interface WalkContext {
  text: string;
  format: Formatter;
  lists: Lists | null;
  /** CPs of section marks (0x0C characters that end a section). */
  sectionMarks: ReadonlySet<number>;
  /** Note references by CP (main story only). */
  notes: ReadonlyMap<number, NoteMark>;
  picture: PictureResolver;
  /** Counts of skipped content, reported as warnings by the caller. */
  skipped: { pictures: number; objects: number; shapes: number };
}

interface Field {
  code: string;
  inResult: boolean;
  href?: string;
}

const HEADING_NAME = /^(?:heading|标题|見出し)\s*([1-9])$/i;
const TITLE_NAME = /^(?:title|标题)$/i;

/** Splits a story range into paragraphs with formatted runs, resolving fields, notes and special characters. */
export function walkStory(ctx: WalkContext, range: CpRange): WalkedParagraph[] {
  const { text } = ctx;
  const out: WalkedParagraph[] = [];
  const fields: Field[] = [];
  let cp = range.start;
  while (cp < range.end) {
    let mark = cp;
    while (mark < range.end && !isMark(ctx, mark)) mark++;
    const hasMark = mark < range.end;
    const { style, props } = ctx.format.paragraph(hasMark ? mark : range.end - 1);
    const runs = collectRuns(ctx, cp, mark, style, fields);
    const markChar = hasMark ? text.charCodeAt(mark) : 13;
    const heading = headingLevel(style.sti, style.name, props.outline);
    const paragraph: WalkedParagraph = {
      kind: "paragraph",
      runs,
      props,
      mark: ctx.format.charAt(hasMark ? mark : range.end - 1, style),
      style: style.name,
      heading,
      title: style.sti === Sti.title || (style.sti === 0x0ffe && TITLE_NAME.test(style.name)),
      terminator: markChar === 7 ? (props.rowEnd ? "row" : "cell") : markChar === 12 ? "section" : "paragraph",
      cpStart: cp,
    };
    if (props.list > 0 && ctx.lists && !props.rowEnd) {
      const marker = ctx.lists.next(props.list, props.listLevel);
      const level = ctx.lists.level(props.list, props.listLevel);
      if (marker !== null && marker !== "") {
        paragraph.marker = marker;
        paragraph.markerFollow = level?.follow === 1 ? "space" : level?.follow === 2 ? "none" : "tab";
      }
    }
    out.push(paragraph);
    cp = mark + 1;
  }
  return out;
}

function isMark(ctx: WalkContext, cp: number): boolean {
  const c = ctx.text.charCodeAt(cp);
  return c === 13 || c === 7 || (c === 12 && ctx.sectionMarks.has(cp));
}

function headingLevel(sti: number, name: string, outline: number): number {
  if (sti >= Sti.heading1 && sti <= Sti.heading9) return sti;
  if (outline >= 0 && outline < 9) return outline + 1;
  const match = sti === 0x0ffe ? HEADING_NAME.exec(name) : null;
  return match ? Number(match[1]) : 0;
}

function collectRuns(
  ctx: WalkContext,
  start: number,
  end: number,
  style: Parameters<Formatter["chars"]>[1],
  fields: Field[],
): DocRun[] {
  const runs: DocRun[] = [];
  let current: DocTextRun | null = null;
  const push = (run: DocRun) => {
    current = null;
    runs.push(run);
  };
  const appendText = (s: string, props: CharProps, href: string | undefined) => {
    if (current && current.href === href && sameProps(current.props, props)) {
      current.text += s;
      return;
    }
    current = { kind: "text", text: s, props, ...(href ? { href } : {}) };
    runs.push(current);
  };

  for (const segment of ctx.format.segments(start, end)) {
    const props = ctx.format.chars(segment, style);
    for (let cp = segment.start; cp < segment.end; cp++) {
      const c = ctx.text.charCodeAt(cp);
      if (c === 0x13) {
        fields.push({ code: "", inResult: false });
        continue;
      }
      if (c === 0x14) {
        const top = fields.at(-1);
        if (top) {
          top.inResult = true;
          const href = hyperlinkTarget(top.code);
          if (href) top.href = href;
        }
        continue;
      }
      if (c === 0x15) {
        fields.pop();
        continue;
      }
      const codeField = innermostCode(fields);
      if (codeField) {
        if (codeField === fields.at(-1) && codeField.code.length < 2048) codeField.code += ctx.text[cp];
        continue;
      }
      if (props.hidden || props.deleted) continue;
      const href = linkOf(fields);
      switch (c) {
        case 0x09:
          appendText("\t", props, href);
          break;
        case 0x0b:
        case 0x0e:
          appendText("\n", props, href);
          break;
        case 0x0c:
          push({ kind: "page-break" });
          break;
        case 0x1e:
          appendText("‑", props, href);
          break;
        case 0x02: {
          const note = props.special ? ctx.notes.get(cp) : undefined;
          if (note) push({ kind: "note", note: note.note, index: note.index, mark: note.mark, props });
          break;
        }
        case 0x01:
        case 0x08:
          if (props.special) {
            const picture = props.picture >= 0 && !props.ole ? ctx.picture(props.picture) : null;
            if (picture) push(picture);
            else ctx.skipped[c === 0x08 ? "shapes" : props.ole ? "objects" : "pictures"]++;
          }
          break;
        default:
          if (c >= 0x20 && c !== 0x1f) appendText(ctx.text[cp]!, props, href);
      }
    }
  }
  return runs;
}

/** The field whose code (instruction) part we are inside, if any; code text is never displayed. */
function innermostCode(fields: Field[]): Field | null {
  for (let i = fields.length - 1; i >= 0; i--) if (!fields[i]!.inResult) return fields[i]!;
  return null;
}

function linkOf(fields: Field[]): string | undefined {
  for (let i = fields.length - 1; i >= 0; i--) if (fields[i]!.href) return fields[i]!.href;
  return undefined;
}

const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;

/** Target of a `HYPERLINK "url"` field when it is an absolute http(s) or mailto URL; local bookmarks are ignored. */
export function hyperlinkTarget(code: string): string | undefined {
  const match = /^\s*HYPERLINK\s+(.*)$/is.exec(code);
  if (!match) return undefined;
  const args = match[1]!;
  if (/^\\l\b/i.test(args.trim())) return undefined;
  const quoted = /"([^"]+)"/.exec(args);
  const target = (quoted ? quoted[1]! : (args.trim().split(/\s+/)[0] ?? "")).trim();
  return SAFE_URL.test(target) ? target : undefined;
}

function sameProps(a: CharProps, b: CharProps): boolean {
  if (a === b) return true;
  for (const key of Object.keys(a) as (keyof CharProps)[]) if (a[key] !== b[key]) return false;
  return true;
}
