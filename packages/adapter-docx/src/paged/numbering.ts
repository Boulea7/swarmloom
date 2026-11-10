const ROMAN: readonly [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** Lower-case roman numeral; values outside 1..3999 fall back to decimal. */
export function roman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  let out = "";
  let rest = n;
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}

/** Word-style letters: a..z, then aa..zz, aaa.. (CSS lower-alpha would continue with ab instead). */
export function wordLetters(n: number): string {
  if (n < 1) return String(n);
  const index = n - 1;
  return String.fromCharCode(97 + (index % 26)).repeat(Math.floor(index / 26) + 1);
}

/** Spreadsheet-style letters as CSS lower-alpha counts: a..z, aa, ab, ... */
export function alphabetic(n: number): string {
  if (n < 1) return String(n);
  let out = "";
  let rest = n;
  while (rest > 0) {
    rest--;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

const CJK_DIGITS = "〇一二三四五六七八九";

/** Informal Chinese numerals for 1..99 (一, 十一, 二十); other values fall back to decimal. */
export function chineseCounting(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  if (n < 10) return CJK_DIGITS[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? CJK_DIGITS[tens] : ""}十${ones ? CJK_DIGITS[ones] : ""}`;
}

/** Digit-by-digit CJK numerals (〇一二...). */
export function cjkDecimal(n: number): string {
  return String(n).replace(/\d/g, (d) => CJK_DIGITS[Number(d)]!);
}

/** Formats a counter value for a CSS list-style-type name (the subset Office documents use). */
export function formatCounter(n: number, style: string): string {
  switch (style.trim().toLowerCase()) {
    case "none":
      return "";
    case "disc":
      return "•";
    case "circle":
      return "◦";
    case "square":
      return "▪";
    case "decimal-leading-zero":
      return n >= 0 && n < 10 ? `0${n}` : String(n);
    case "lower-roman":
      return roman(n);
    case "upper-roman":
      return roman(n).toUpperCase();
    case "lower-alpha":
    case "lower-latin":
      return alphabetic(n);
    case "upper-alpha":
    case "upper-latin":
      return alphabetic(n).toUpperCase();
    case "cjk-decimal":
      return cjkDecimal(n);
    case "cjk-ideographic":
    case "simp-chinese-informal":
    case "trad-chinese-informal":
    case "japanese-informal":
      return chineseCounting(n);
    default:
      return String(n);
  }
}
