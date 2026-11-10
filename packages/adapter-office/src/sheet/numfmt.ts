/**
 * A deliberately small Excel number-format engine: General, fixed decimals, thousands
 * separators, percent, scientific, scaling commas, literals, currency tags, sections
 * (positive;negative;zero;text) and dates/times. Fractions are shown as decimals and
 * conditions are ignored (documented gaps).
 */

/** Built-in format codes by numFmtId (ECMA-376 Part 1, 18.8.30; en-US rendering). */
export const BUILTIN_FORMATS: Readonly<Record<number, string>> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: '"$"#,##0_);("$"#,##0)',
  6: '"$"#,##0_);[Red]("$"#,##0)',
  7: '"$"#,##0.00_);("$"#,##0.00)',
  8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const COLOR_TAG = /\[(?:red|black|blue|cyan|green|magenta|white|yellow|color\s*\d+)\]/gi;
const CONDITION_TAG = /\[[<>=]+[^\]]*\]/g;

/** Splits a format code into sections on unquoted, unescaped semicolons. */
function sections(code: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\\" && !quoted) {
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === "[") {
      bracket = true;
    } else if (!quoted && ch === "]") {
      bracket = false;
    } else if (!quoted && !bracket && ch === ";") {
      out.push(code.slice(start, i));
      start = i + 1;
    }
  }
  out.push(code.slice(start));
  return out;
}

interface Token {
  /** Literal text is copied verbatim; code text is interpreted. */
  kind: "lit" | "code";
  text: string;
}

/** Tokenises one section into literal runs and format code runs. */
function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: Token["kind"], text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };
  for (let i = 0; i < section.length; i++) {
    const ch = section[i] as string;
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      const stop = end < 0 ? section.length : end;
      push("lit", section.slice(i + 1, stop));
      i = stop;
    } else if (ch === "\\") {
      push("lit", section[i + 1] ?? "");
      i++;
    } else if (ch === "_") {
      // Space as wide as the next character.
      push("lit", " ");
      i++;
    } else if (ch === "*") {
      // Repeat-to-fill character: not meaningful at our fixed widths.
      i++;
    } else if (ch === "[") {
      const end = section.indexOf("]", i + 1);
      const stop = end < 0 ? section.length : end;
      const inner = section.slice(i + 1, stop);
      // [$EUR-407] style tags carry a currency symbol; [h]/[mm]/[ss] are elapsed time codes.
      if (inner.startsWith("$")) push("lit", inner.slice(1).split("-")[0] ?? "");
      else if (/^(h+|m+|s+)$/i.test(inner)) push("code", `[${inner.toLowerCase()}]`);
      i = stop;
    } else if (/[0#?.,%eE+/:yYmMdDhHsSaApP@]/.test(ch)) {
      push("code", ch);
    } else {
      push("lit", ch);
    }
  }
  return tokens;
}

function isDateCode(tokens: readonly Token[]): boolean {
  return tokens.some(
    (t) => t.kind === "code" && /[yYdDhHsSmM]|\[[hms]+\]/.test(t.text.replace(/[eE][+-]|AM\/PM|A\/P/gi, "")),
  );
}

/** Formats `value` with an Excel format code. `date1904` selects the Mac epoch. */
export function formatNumber(value: number, code: string | undefined, date1904 = false): string {
  if (!Number.isFinite(value)) return String(value);
  if (!code || /^general$/i.test(code.trim())) return formatGeneral(value);
  const parts = sections(code);
  let section = parts[0] ?? "";
  let v = value;
  if (value < 0 && parts.length >= 2) {
    section = parts[1] ?? "";
    v = -value;
  } else if (value === 0 && parts.length >= 3) {
    section = parts[2] ?? "";
  }
  // Conditions like [>=100] are not evaluated; strip them so the rest still formats.
  section = section.replace(CONDITION_TAG, "").replace(COLOR_TAG, "");
  if (/^general$/i.test(section.trim())) return formatGeneral(v);
  const tokens = tokenize(section);
  if (isDateCode(tokens)) return formatDate(value, tokens, date1904);
  return formatNumeric(v, tokens);
}

/** Excel's General: about 11 significant characters, exponent notation for extremes. */
export function formatGeneral(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e11 || abs < 1e-9) {
    const [mant = "", exp = "0"] = value.toExponential(5).split("e");
    const m = mant.includes(".") ? mant.replace(/\.?0+$/, "") : mant;
    const e = Number(exp);
    return `${m}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  if (Number.isInteger(value)) return String(value);
  const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
  const decimals = Math.max(0, 10 - intDigits);
  const text = value.toFixed(decimals);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

const DIGITS = /[0#?][0#?,. ]*(?:[eE][+-][0#?]+)?|\.[0#?][0#?, ]*/;

function formatNumeric(value: number, tokens: readonly Token[]): string {
  const codeText = tokens
    .filter((t) => t.kind === "code")
    .map((t) => t.text)
    .join("");
  if (codeText.includes("@") && !/[0#?]/.test(codeText)) return renderTokens(tokens, formatGeneral(value));
  // Single-section formats show the sign in front of any prefix ("-$5.00", not "$-5.00").
  const negative = value < 0;
  let v = Math.abs(value);
  const percents = codeText.match(/%/g)?.length ?? 0;
  if (percents) v *= 100 ** percents;
  const pattern = DIGITS.exec(codeText)?.[0] ?? "";
  if (!pattern) return renderTokens(tokens, "");
  const sci = /[eE]([+-])([0#?]+)$/.exec(pattern);
  const mantissa = sci ? pattern.slice(0, sci.index) : pattern;
  const [intPart = "", fracPart = ""] = mantissa.trimEnd().split(".");
  // Trailing commas after the last digit placeholder scale by 1000 each.
  const scaleCommas = /,+$/.exec(mantissa.trimEnd())?.[0].length ?? 0;
  if (scaleCommas) v /= 1000 ** scaleCommas;
  const decimals = fracPart.match(/[0#?]/g)?.length ?? 0;
  const minDecimals = fracPart.match(/[0?]/g)?.length ?? 0;
  const minInt = intPart.match(/[0?]/g)?.length ?? 0;
  const grouping = /[0#?],+[0#?]/.test(intPart);
  const sign = (text: string) => (negative && /[1-9]/.test(text) ? `-${text}` : text);
  // Fractions are approximated by decimals (documented gap).
  if (/\?\/[?\d]/.test(codeText)) return sign(trimZeros(v.toFixed(4), 0));
  const numberText = sci
    ? scientific(v, decimals, sci[1] === "+", sci[2]?.length ?? 2, intPart.length)
    : fixed(v, decimals, minDecimals, minInt, grouping);
  return sign(renderTokens(tokens, numberText));
}

/** Formats a non-negative value with fixed decimals, integer padding and grouping. */
function fixed(v: number, decimals: number, minDecimals: number, minInt: number, grouping: boolean): string {
  const text = trimZeros(v.toFixed(decimals), minDecimals);
  const dot = text.indexOf(".");
  let int = dot < 0 ? text : text.slice(0, dot);
  const frac = dot < 0 ? "" : text.slice(dot + 1);
  if (int === "0" && minInt === 0) int = "";
  if (int.length < minInt) int = int.padStart(minInt, "0");
  if (grouping) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${int}.${frac}` : int;
  return body === "" ? "0" : body;
}

/** Drops trailing fractional zeros beyond `keep` digits (and the dot when nothing is left). */
function trimZeros(text: string, keep: number): string {
  const dot = text.indexOf(".");
  if (dot < 0) return text;
  let end = text.length;
  while (end > dot + 1 + keep && text[end - 1] === "0") end--;
  return end === dot + 1 ? text.slice(0, dot) : text.slice(0, end);
}

/** Scientific notation of a non-negative value. */
function scientific(abs: number, decimals: number, plus: boolean, expDigits: number, intWidth: number): string {
  if (abs === 0) return `${(0).toFixed(decimals)}E${plus ? "+" : ""}${"0".repeat(expDigits)}`;
  // Engineering patterns such as ##0.0E+0 keep the exponent a multiple of the int width.
  let exp = Math.floor(Math.log10(abs));
  if (intWidth > 1) exp = Math.floor(exp / intWidth) * intWidth;
  let mant = abs / 10 ** exp;
  if (Number(mant.toFixed(decimals)) >= 10 ** Math.max(1, intWidth)) {
    exp += Math.max(1, intWidth);
    mant = abs / 10 ** exp;
  }
  const expSign = exp < 0 ? "-" : plus ? "+" : "";
  return `${mant.toFixed(decimals)}E${expSign}${String(Math.abs(exp)).padStart(expDigits, "0")}`;
}

/** Renders literals verbatim and puts `numberText` where the first digit run was. */
function renderTokens(tokens: readonly Token[], numberText: string): string {
  let out = "";
  let placed = false;
  for (const t of tokens) {
    if (t.kind === "lit") {
      out += t.text;
      continue;
    }
    const m = placed ? null : /[0#?@][0#?,.@ ]*(?:[eE][+-][0#?]+)?|\.[0#?][0#?, ]*/.exec(t.text);
    if (!m) {
      // Leftover code characters (%, +, /, :) are shown; digit placeholders are not.
      out += t.text.replace(/[eE][+-]/g, "").replace(/[0#?@,.]/g, "");
      continue;
    }
    const after = t.text.slice(m.index + m[0].length).replace(/[0#?,]/g, "");
    out += t.text.slice(0, m.index) + numberText + (m[0].endsWith(" ") ? " " : "") + after;
    placed = true;
  }
  return out;
}

/** Civil date and clock parts of a serial date. */
export interface DateParts {
  y: number;
  /** 1-12. */
  m: number;
  d: number;
  /** Day of week, 0 = Sunday. */
  wd: number;
  hh: number;
  mm: number;
  ss: number;
  /** Fraction of a second. */
  frac: number;
}

/** Serial date -> civil parts (proleptic Gregorian, with Excel's 1900 leap-year quirk). */
export function serialToParts(serial: number, date1904 = false): DateParts {
  let days = Math.floor(serial);
  // Round to the millisecond so 0.9999999 does not render as 23:59:59.
  let ms = Math.round((serial - days) * 86400000);
  if (ms >= 86400000) {
    days++;
    ms -= 86400000;
  }
  const time = clock(ms / 1000);
  let epochDays: number;
  if (date1904) {
    epochDays = daysFromCivil(1904, 1, 1);
  } else {
    // Serial 60 is the non-existent 1900-02-29; serials below it are shifted by one day.
    if (days === 60) return { y: 1900, m: 2, d: 29, wd: 3, ...time };
    epochDays = daysFromCivil(1899, 12, days < 60 ? 31 : 30);
  }
  const total = epochDays + days;
  const civil = civilFromDays(total);
  const wd = (((total + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday.
  return { ...civil, wd, ...time };
}

function clock(seconds: number): { hh: number; mm: number; ss: number; frac: number } {
  const whole = Math.floor(seconds);
  return { hh: Math.floor(whole / 3600), mm: Math.floor((whole % 3600) / 60), ss: whole % 60, frac: seconds - whole };
}

/** Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): { y: number; m: number; d: number } {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

interface DateUnit {
  lit?: string;
  code?: string;
}

const DATE_CODE = /\[[hms]+\]|AM\/PM|A\/P|y+|m+|d+|h+|s+|\.0+|./gi;

function dateUnits(tokens: readonly Token[]): DateUnit[] {
  const units: DateUnit[] = [];
  for (const t of tokens) {
    if (t.kind === "lit") units.push({ lit: t.text });
    else for (const m of t.text.matchAll(DATE_CODE)) units.push({ code: m[0] });
  }
  return units;
}

function formatDate(serial: number, tokens: readonly Token[], date1904: boolean): string {
  if (serial < 0) return "########";
  const p = serialToParts(serial, date1904);
  const units = dateUnits(tokens);
  const ampm = units.some((u) => u.code !== undefined && /^(AM\/PM|A\/P)$/i.test(u.code));
  let out = "";
  for (let i = 0; i < units.length; i++) {
    const unit = units[i] as DateUnit;
    if (unit.code === undefined) {
      out += unit.lit ?? "";
      continue;
    }
    out += dateCode(unit.code, p, serial, ampm, units, i);
  }
  return out;
}

function dateCode(code: string, p: DateParts, serial: number, ampm: boolean, units: DateUnit[], i: number): string {
  const lower = code.toLowerCase();
  const width = lower.length;
  if (lower.startsWith("[")) {
    const unit = lower[1];
    const value = unit === "h" ? serial * 24 : unit === "m" ? serial * 1440 : serial * 86400;
    return String(Math.floor(value + 1e-9)).padStart(width - 2, "0");
  }
  if (lower === "am/pm") return p.hh < 12 ? "AM" : "PM";
  if (lower === "a/p") return p.hh < 12 ? "A" : "P";
  switch (lower[0]) {
    case "y":
      return width <= 2 ? pad2(p.y % 100) : String(p.y);
    case "m": {
      if (width <= 2 && isMinute(units, i)) return width === 2 ? pad2(p.mm) : String(p.mm);
      const name = MONTHS[p.m - 1] ?? "";
      if (width >= 5) return name.slice(0, 1);
      if (width === 4) return name;
      if (width === 3) return name.slice(0, 3);
      return width === 2 ? pad2(p.m) : String(p.m);
    }
    case "d": {
      const name = DAYS[p.wd] ?? "";
      if (width >= 4) return name;
      if (width === 3) return name.slice(0, 3);
      return width === 2 ? pad2(p.d) : String(p.d);
    }
    case "h": {
      const h = ampm ? ((p.hh + 11) % 12) + 1 : p.hh;
      return width >= 2 ? pad2(h) : String(h);
    }
    case "s":
      return width >= 2 ? pad2(p.ss) : String(p.ss);
    case ".":
      return width > 1 ? `.${String(Math.floor(p.frac * 10 ** (width - 1))).padStart(width - 1, "0")}` : ".";
    case "@":
      return "";
    default:
      return code;
  }
}

/** `m` means minutes right after an hour code or right before a seconds code. */
function isMinute(units: DateUnit[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = units[i]?.code?.toLowerCase();
    if (c === undefined || !/[a-z]/.test(c)) continue;
    if (/^(h+|\[h+\])$/.test(c)) return true;
    break;
  }
  for (let i = index + 1; i < units.length; i++) {
    const c = units[i]?.code?.toLowerCase();
    if (c === undefined || !/[a-z]/.test(c)) continue;
    if (/^(s+|\[s+\])$/.test(c)) return true;
    break;
  }
  return false;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when a format code renders dates or times. */
export function isDateFormat(code: string | undefined): boolean {
  if (!code || /^general$/i.test(code.trim())) return false;
  const first = (sections(code)[0] ?? "").replace(CONDITION_TAG, "").replace(COLOR_TAG, "");
  return isDateCode(tokenize(first));
}
