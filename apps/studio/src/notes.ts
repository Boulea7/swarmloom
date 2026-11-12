import type { StudioI18n, StudioKey } from "./i18n";

/**
 * The font note of the document adapters (decisions-v1 F01) in each wording they use (OpenDocument,
 * Office, DOCX and DOC): "Fonts ...: Calibri -> Carlito, SimSun → Noto Serif SC and 2 more."
 */
const FONT_NOTE = /^Fonts\b/;
const FONT_MORE = / and (\d+) more$/;
/** DOCX names a font without an open substitute by its generic family: "a serif font" is shown as "serif". */
const GENERIC_FONT = /^an? (\S+) font$/;

/**
 * Adapter notes Studio rewords, by their English wording: Lottie (`dotlottie.ts`, `lottie/validate.ts`),
 * EPUB (`statsNotes`), OpenDocument (`kindNotes`, also images shared with EPUB) and DOCX. The first
 * group is the count, the second the Lottie animation name.
 */
const FIXED_NOTES: ReadonlyArray<readonly [RegExp, StudioKey]> = [
  [/^The \.lottie archive has no manifest; its first animation is shown\.$/, "note.lottie.noManifest"],
  [/^This \.lottie holds (\d+) animations; "(.*)" is shown\.$/, "note.lottie.animations"],
  [/^(\d+) image\(s\) in an unsupported format were left out\.$/, "note.lottie.imageFormat"],
  [/^(\d+) image\(s\) are not embedded in the file and were left out\.$/, "note.lottie.imageExternal"],
  [/^(\d+) audio or data asset\(s\) were removed\.$/, "note.lottie.footage"],
  [/^(\d+) asset\(s\) that repeat an earlier asset's id were removed\.$/, "note.lottie.duplicate"],
  [/^(\d+) image slot\(s\) were removed; the file's own images are shown\.$/, "note.lottie.slots"],
  [/^A malformed font list was removed\.$/, "note.lottie.fontList"],
  [/^(\d+) web font\(s\) were replaced by locally installed fonts\.$/, "note.lottie.webFonts"],
  [/^Text animators with a random letter order play in a fixed order\.$/, "note.lottie.textOrder"],
  [/^Audio layers are not played\.$/, "note.lottie.audioLayers"],
  [/^Data layers are not played\.$/, "note.lottie.dataLayers"],
  [/^(\d+) expression\(s\) were ignored; their properties keep their keyframed values\.$/, "note.lottie.expressions"],
  [
    /^(\d+) image\(s\) could not be shown \(missing, linked externally or not a supported type\)\.$/,
    "note.images.missing",
  ],
  [/^Obfuscated embedded fonts were replaced by fallback fonts\.$/, "note.epub.obfuscatedFonts"],
  [/^Scripts in the book were not run\.$/, "note.epub.scripts"],
  [/^(\d+) chapter\(s\) could not be read and were skipped\.$/, "note.epub.chapters"],
  [/^Cells show their saved values; formulas are not recalculated\.$/, "note.odf.formulas"],
  [/^(\d+) embedded object\(s\) \(charts, formulas, OLE\) are shown as placeholders\.$/, "note.odf.objects"],
  [/^(\d+) table\(s\) were cut to fit the size limits\.$/, "note.odf.tableCuts"],
  [/^(\d+) shape fill\(s\) or outline\(s\) were simplified\.$/, "note.odf.shapes"],
  [
    /^Pages start at section and page breaks saved in the document; Word's automatic page flow is not recalculated, so some pages are longer than in Word\.$/,
    "note.docx.pagination",
  ],
];

/** EPUB `outlineNote`: "Outline: Part one / Chapter 1 (+4 more)."; the entries stay as written. */
const OUTLINE = "Outline: ";
const OUTLINE_MORE = / \(\+(\d+) more\)$/;
/** DOCX `plainSheets`: "The simplified view leaves out 2 pictures, headers and footers, footnotes." */
const LEFT_OUT = "The simplified view leaves out ";
const LEFT_OUT_PICTURES = /^(\d+) pictures?$/;
const LEFT_OUT_PARTS: ReadonlyMap<string, StudioKey> = new Map([
  ["headers and footers", "note.docx.headersFooters"],
  ["footnotes", "note.docx.footnotes"],
]);
/** DOCX renderer fallback; the reason in parentheses is an error text and stays as written. */
const FALLBACK_HEAD = "The full renderer could not lay out this document (";
const FALLBACK_TAIL = "), so a simplified view is shown.";

function listOf(locale: string, items: string[]): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/**
 * One "Calibri -> Carlito" item as [font, substitute], or null. The substitute comes from the
 * adapters' own tables, while the font name is the document's and may hold anything (arrows, long
 * runs of spaces), so the item is split at its last arrow by index rather than with a backtracking
 * pattern, which took seconds to minutes on crafted names.
 */
function fontPair(item: string): readonly [string, string] | null {
  const arrow = item.lastIndexOf("->");
  const at = Math.max(arrow, item.lastIndexOf("→"));
  if (at < 0) return null;
  const from = item.slice(0, at).trim();
  const to = item.slice(at + (at === arrow ? 2 : 1)).trim();
  return from && to ? [from, to] : null;
}

/** A font substitution note in the UI language (font names stay as they are), or null. */
function localizeFonts(note: string, i18n: StudioI18n): string | null {
  const colon = note.indexOf(":");
  if (colon < 0 || !FONT_NOTE.test(note)) return null;
  let list = note.slice(colon + 1).trim();
  if (list.endsWith(".")) list = list.slice(0, -1);
  const more = FONT_MORE.exec(list);
  if (more) list = list.slice(0, more.index);
  const pairs: string[] = [];
  for (const item of list.split(/,\s*/)) {
    const pair = fontPair(item);
    if (!pair) return null;
    const [from, to] = pair;
    pairs.push(`${from} → ${GENERIC_FONT.exec(to)?.[1] ?? to}`);
  }
  const count = Number(more?.[1] ?? 0);
  if (count > 0) pairs.push(i18n.t("player.fonts.more", { count }));
  return i18n.t("player.fonts", { fonts: listOf(i18n.locale, pairs) });
}

/** The middle of `text` between `head` and `tail`, or null when it does not have that frame. */
function between(text: string, head: string, tail: string): string | null {
  if (text.length < head.length + tail.length || !text.startsWith(head) || !text.endsWith(tail)) return null;
  return text.slice(head.length, text.length - tail.length);
}

/** The EPUB outline note in the UI language, or null. */
function localizeOutline(note: string, i18n: StudioI18n): string | null {
  let entries = between(note, OUTLINE, ".");
  if (!entries) return null;
  const more = OUTLINE_MORE.exec(entries);
  if (!more) return i18n.t("note.epub.outline", { entries });
  entries = entries.slice(0, more.index);
  return i18n.t("note.epub.outlineMore", { entries, count: Number(more[1]) });
}

/** The DOCX simplified view's "leaves out" note in the UI language, or null. */
function localizeLeftOut(note: string, i18n: StudioI18n): string | null {
  const list = between(note, LEFT_OUT, ".");
  if (!list) return null;
  const items: string[] = [];
  for (const item of list.split(", ")) {
    const pictures = LEFT_OUT_PICTURES.exec(item);
    const key = pictures ? "note.docx.pictures" : LEFT_OUT_PARTS.get(item);
    if (!key) return null;
    items.push(i18n.t(key, { count: Number(pictures?.[1] ?? 0) }));
  }
  return i18n.t("note.docx.leftOut", { items: listOf(i18n.locale, items) });
}

/** The DOCX renderer fallback note in the UI language, or null. */
function localizeFallback(note: string, i18n: StudioI18n): string | null {
  const reason = between(note, FALLBACK_HEAD, FALLBACK_TAIL);
  return reason === null ? null : i18n.t("note.docx.fallback", { reason });
}

/**
 * An adapter quality note in the UI language. Adapters write their notes in English; Studio rewords
 * the font substitutions most Office and OpenDocument files report and every Lottie, EPUB,
 * OpenDocument and DOCX note, and returns any other note unchanged.
 */
export function localizeNote(note: string, i18n: StudioI18n): string {
  const text = note.trim();
  for (const [pattern, key] of FIXED_NOTES) {
    const match = pattern.exec(text);
    if (match) return i18n.t(key, { count: Number(match[1] ?? 0), name: match[2] ?? "" });
  }
  return (
    localizeOutline(text, i18n) ??
    localizeLeftOut(text, i18n) ??
    localizeFallback(text, i18n) ??
    localizeFonts(text, i18n) ??
    note
  );
}
