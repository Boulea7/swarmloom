import type { StudioI18n, StudioKey } from "./i18n";

/**
 * The font note of the document adapters (decisions-v1 F01) in each wording they use (OpenDocument,
 * Office, DOCX and DOC): "Fonts ...: Calibri -> Carlito, SimSun → Noto Serif SC and 2 more."
 */
const FONT_NOTE = /^Fonts\b[^:]*:\s*(.+?)(?: and (\d+) more)?\.?$/;
const FONT_PAIR = /^(.+?)\s*(?:->|→)\s*(.+)$/;
/** DOCX names a font without an open substitute by its generic family: "a serif font" is shown as "serif". */
const GENERIC_FONT = /^an? (\S+) font$/;

/**
 * The Lottie adapter's notes (adapter-lottie `dotlottie.ts` and `lottie/validate.ts`) by their
 * English wording. The first group is the count, the second the animation name.
 */
const LOTTIE_NOTES: ReadonlyArray<readonly [RegExp, StudioKey]> = [
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
];

function listOf(locale: string, items: string[]): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** A font substitution note in the UI language (font names stay as they are), or null. */
function localizeFonts(note: string, i18n: StudioI18n): string | null {
  const match = FONT_NOTE.exec(note);
  if (!match) return null;
  const pairs: string[] = [];
  for (const item of (match[1] ?? "").split(/,\s*/)) {
    const pair = FONT_PAIR.exec(item);
    if (!pair) return null;
    const [, from = "", to = ""] = pair;
    pairs.push(`${from} → ${GENERIC_FONT.exec(to)?.[1] ?? to}`);
  }
  const more = Number(match[2] ?? 0);
  if (more > 0) pairs.push(i18n.t("player.fonts.more", { count: more }));
  return i18n.t("player.fonts", { fonts: listOf(i18n.locale, pairs) });
}

/**
 * An adapter quality note in the UI language. Adapters write their notes in English; Studio rewords
 * the font substitutions most Office and OpenDocument files report and every Lottie note, and
 * returns any other note unchanged.
 */
export function localizeNote(note: string, i18n: StudioI18n): string {
  const text = note.trim();
  for (const [pattern, key] of LOTTIE_NOTES) {
    const match = pattern.exec(text);
    if (match) return i18n.t(key, { count: Number(match[1] ?? 0), name: match[2] ?? "" });
  }
  return localizeFonts(text, i18n) ?? note;
}
