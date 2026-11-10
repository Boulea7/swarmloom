/** Private-use code points of the Symbol/Wingdings fonts that Word uses for bullets, mapped to Unicode. */
const SYMBOLS: Record<number, string> = {
  61623: "•",
  61548: "●",
  61599: "•",
  61607: "▪",
  61550: "■",
  61553: "❏",
  61557: "◆",
  61558: "❖",
  61656: "➢",
  61672: "➔",
  61692: "✓",
  61551: "◦",
  61608: "◦",
  61485: "–",
};

/**
 * Replaces symbol-font private-use characters (U+F000..U+F0FF) with visible Unicode equivalents;
 * unknown ones become a plain bullet so no tofu box is shown.
 */
export function mapSymbolText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= 0xf000 && code <= 0xf0ff ? (SYMBOLS[code] ?? "•") : ch;
  }
  return out;
}
