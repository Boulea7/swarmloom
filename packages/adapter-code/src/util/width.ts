/**
 * Display width of text in monospace columns: East Asian wide and fullwidth characters (CJK,
 * Hangul, kana, fullwidth forms) and emoji count 2, combining marks 0, everything else 1.
 */
export function columnWidth(text: string): number {
  let cols = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCombining(cp)) continue;
    cols += isWide(cp) ? 2 : 1;
  }
  return cols;
}

function isCombining(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0x20d0 && cp <= 0x20ff)
  );
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}
