import type { StudioI18n } from "./i18n";

/**
 * The font note of the document adapters (decisions-v1 F01) in each wording they use (OpenDocument,
 * Office, DOCX and DOC): "Fonts ...: Calibri -> Carlito, SimSun → Noto Serif SC and 2 more."
 */
const FONT_NOTE = /^Fonts\b[^:]*:\s*(.+?)(?: and (\d+) more)?\.?$/;
const FONT_PAIR = /^(.+?)\s*(?:->|→)\s*(.+)$/;
/** DOCX names a font without an open substitute by its generic family: "a serif font" is shown as "serif". */
const GENERIC_FONT = /^an? (\S+) font$/;

function listOf(locale: string, items: string[]): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/**
 * An adapter quality note in the UI language. Adapters write their notes in English; Studio rewords
 * the font substitutions most Office and OpenDocument files report (the font names stay as they
 * are) and returns any other note unchanged.
 */
export function localizeNote(note: string, i18n: StudioI18n): string {
  const match = FONT_NOTE.exec(note.trim());
  if (!match) return note;
  const pairs: string[] = [];
  for (const item of (match[1] ?? "").split(/,\s*/)) {
    const pair = FONT_PAIR.exec(item);
    if (!pair) return note;
    const [, from = "", to = ""] = pair;
    pairs.push(`${from} → ${GENERIC_FONT.exec(to)?.[1] ?? to}`);
  }
  const more = Number(match[2] ?? 0);
  if (more > 0) pairs.push(i18n.t("player.fonts.more", { count: more }));
  return i18n.t("player.fonts", { fonts: listOf(i18n.locale, pairs) });
}
