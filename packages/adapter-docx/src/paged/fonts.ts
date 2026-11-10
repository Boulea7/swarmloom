/** CSS generic family used as the last resort of a stack. */
export type GenericFamily = "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy";

interface FontFallback {
  /** Metric-compatible or look-alike families, most faithful first. */
  alternatives: string[];
  generic: GenericFamily;
  /** CJK fallbacks to append (Office documents often mix Latin and CJK runs). */
  cjk: "sans" | "serif" | "mono";
}

const CJK_SANS = [
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans SC",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "Hiragino Sans",
  "Yu Gothic",
  "Apple SD Gothic Neo",
  "Malgun Gothic",
];
const CJK_SERIF = [
  "Songti SC",
  "STSong",
  "SimSun",
  "Noto Serif SC",
  "Noto Serif CJK SC",
  "Source Han Serif SC",
  "Hiragino Mincho ProN",
  "Yu Mincho",
];

const SANS = (...alternatives: string[]): FontFallback => ({ alternatives, generic: "sans-serif", cjk: "sans" });
const SERIF = (...alternatives: string[]): FontFallback => ({ alternatives, generic: "serif", cjk: "serif" });
const MONO = (...alternatives: string[]): FontFallback => ({ alternatives, generic: "monospace", cjk: "mono" });

/**
 * Common Office fonts and the open or system fonts that stand in for them (keys are lower-case). The
 * first alternative follows the shared v1 table (contracts/decisions-v1.md F01): Calibri -> Carlito,
 * Cambria -> Caladea, Arial/Helvetica -> Liberation Sans, Times New Roman -> Liberation Serif,
 * Courier New -> Liberation Mono, SimSun -> Noto Serif SC, Microsoft YaHei/SimHei -> Noto Sans SC, and
 * the same for Traditional Chinese, Japanese and Korean.
 */
const KNOWN: Record<string, FontFallback> = {
  calibri: SANS("Carlito", "Segoe UI", "Helvetica Neue", "Arial"),
  "calibri light": SANS("Carlito", "Segoe UI Light", "Helvetica Neue", "Arial"),
  aptos: SANS("Carlito", "Segoe UI", "Helvetica Neue", "Arial"),
  arial: SANS("Liberation Sans", "Arimo", "Helvetica Neue", "Helvetica"),
  helvetica: SANS("Liberation Sans", "Helvetica Neue", "Arial"),
  "segoe ui": SANS("Helvetica Neue", "Ubuntu", "Arial"),
  tahoma: SANS("Verdana", "DejaVu Sans", "Arial"),
  verdana: SANS("DejaVu Sans", "Tahoma", "Arial"),
  "trebuchet ms": SANS("Segoe UI", "Arial"),
  "century gothic": SANS("Avenir", "URW Gothic", "Arial"),
  "times new roman": SERIF("Liberation Serif", "Tinos", "Times"),
  times: SERIF("Times New Roman", "Liberation Serif"),
  cambria: SERIF("Caladea", "Georgia", "Times New Roman"),
  georgia: SERIF("Gelasio", "Times New Roman"),
  garamond: SERIF("EB Garamond", "Georgia"),
  "book antiqua": SERIF("Palatino Linotype", "Palatino", "Georgia"),
  "courier new": MONO("Liberation Mono", "Cousine", "Courier"),
  courier: MONO("Courier New", "Liberation Mono"),
  consolas: MONO("Menlo", "Monaco", "Liberation Mono"),
  "lucida console": MONO("Menlo", "Monaco", "Liberation Mono"),
  simsun: SERIF("Noto Serif SC", "Songti SC", "STSong", "Noto Serif CJK SC"),
  宋体: SERIF("SimSun", "Noto Serif SC", "Songti SC", "STSong", "Noto Serif CJK SC"),
  nsimsun: SERIF("SimSun", "Noto Serif SC", "Songti SC"),
  新宋体: SERIF("NSimSun", "SimSun", "Noto Serif SC", "Songti SC"),
  simhei: SANS("Noto Sans SC", "Heiti SC", "PingFang SC", "Noto Sans CJK SC"),
  黑体: SANS("SimHei", "Noto Sans SC", "Heiti SC", "PingFang SC", "Noto Sans CJK SC"),
  "microsoft yahei": SANS("Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC"),
  微软雅黑: SANS("Microsoft YaHei", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC"),
  dengxian: SANS("Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"),
  等线: SANS("DengXian", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"),
  kaiti: SERIF("Kaiti SC", "STKaiti", "KaiTi_GB2312", "Noto Serif SC"),
  楷体: SERIF("KaiTi", "Kaiti SC", "STKaiti", "Noto Serif SC"),
  fangsong: SERIF("STFangsong", "FangSong_GB2312", "Noto Serif SC"),
  仿宋: SERIF("FangSong", "STFangsong", "Noto Serif SC"),
  mingliu: SERIF("Noto Serif TC", "PMingLiU", "Songti TC"),
  pmingliu: SERIF("Noto Serif TC", "MingLiU", "Songti TC"),
  新細明體: SERIF("PMingLiU", "Noto Serif TC", "Songti TC"),
  "microsoft jhenghei": SANS("Noto Sans TC", "PingFang TC", "Heiti TC"),
  微軟正黑體: SANS("Microsoft JhengHei", "Noto Sans TC", "PingFang TC"),
  "ms mincho": SERIF("Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP"),
  "ms gothic": SANS("Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP"),
  "yu gothic": SANS("Noto Sans JP", "Hiragino Sans", "Noto Sans CJK JP"),
  meiryo: SANS("Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP"),
  "malgun gothic": SANS("Noto Sans KR", "Apple SD Gothic Neo", "Noto Sans CJK KR"),
  gulim: SANS("Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic"),
  dotum: SANS("Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic"),
  batang: SERIF("Noto Serif KR", "AppleMyungjo", "Noto Serif CJK KR"),
};

function guess(name: string, generic: GenericFamily | null | undefined): FontFallback {
  const n = name.toLowerCase();
  if (generic === "monospace" || /mono|courier|code|consol/.test(n)) return MONO();
  if (generic === "serif" || /serif|song|ming|mincho|batang|times|roman|garamond|宋|明/.test(n)) {
    if (!/sans/.test(n)) return SERIF();
  }
  return { ...SANS(), generic: generic === "cursive" || generic === "fantasy" ? generic : "sans-serif" };
}

function quote(name: string): string {
  return /^[a-z-]+$/i.test(name) && !GENERICS.has(name.toLowerCase()) ? name : `"${name.replace(/["\\]/g, "")}"`;
}

const GENERICS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial"]);

/**
 * A CSS font-family stack for an Office font name: the font itself, look-alikes for machines that
 * lack it, CJK fallbacks and a generic family. `generic` is the document's own hint when known.
 */
export function fontStack(name: string, generic?: GenericFamily | null): string {
  const clean = name.trim();
  const fallback = KNOWN[clean.toLowerCase()] ?? guess(clean, generic);
  const cjk = fallback.cjk === "serif" ? CJK_SERIF : CJK_SANS;
  const names = [clean, ...fallback.alternatives, ...cjk].filter((n) => n !== "");
  return [...new Set(names)].map(quote).concat(fallback.generic).join(", ");
}

function unquote(name: string): string {
  return name
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();
}

/**
 * Appends fallbacks to an existing font-family list (as written by a renderer), based on its first
 * concrete family. Lists that already end in a generic family are left alone, and so are lists that
 * use var(): the variables get their fallbacks where they are defined (`rewriteFontFamilies`), and an
 * undefined variable would invalidate the whole declaration anyway.
 */
export function withFontFallbacks(list: string): string {
  const families = splitFamilies(list);
  if (families.length === 0) return list;
  const last = unquote(families[families.length - 1]!).toLowerCase();
  if (GENERICS.has(last) || families.some((f) => f.includes("var("))) return list;
  const first = families.map(unquote).find((f) => f !== "");
  const stack = fontStack(first ?? "Calibri")
    .split(", ")
    .slice(first ? 1 : 0);
  return [...families.map((f) => f.trim()), ...stack].join(", ");
}

/** Splits a font-family value at top-level commas (commas inside quotes or var() are kept). */
function splitFamilies(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoteChar = "";
  let current = "";
  for (const ch of list) {
    if (quoteChar) {
      if (ch === quoteChar) quoteChar = "";
    } else if (ch === '"' || ch === "'") {
      quoteChar = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Rewrites every `font-family` declaration and `--*-font` theme variable in a style sheet so that
 * missing Office fonts degrade to look-alikes instead of the browser default.
 */
export function rewriteFontFamilies(css: string): string {
  return css
    .replace(
      /(font-family\s*:\s*)([^;}!]+)/gi,
      (_m, prop: string, value: string) => `${prop}${withFontFallbacks(value)}`,
    )
    .replace(
      /(--[\w-]*font\s*:\s*)([^;}!]+)/gi,
      (_m, prop: string, value: string) => `${prop}${withFontFallbacks(value)}`,
    );
}

/** Text that differs between most Latin, CJK and Hangul fonts and the generic families. */
const PROBE = "mmmmmmmmmmlli1WQ@\u6c38\u56fd\u3042\ud55c";
const PROBE_BASES = ["monospace", "serif", "sans-serif"] as const;
const MAX_PROBED = 32;

/**
 * The families in `names` that are not available to `doc` (neither installed nor loaded), found by
 * comparing text widths against the generic families on a canvas. Returns [] when canvas text metrics
 * are unavailable (e.g. non-browser environments), so callers only ever under-report.
 */
export function missingFonts(doc: Document, names: Iterable<string>): string[] {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = doc.createElement("canvas").getContext("2d");
  } catch {
    return [];
  }
  if (!ctx || typeof ctx.measureText !== "function") return [];
  const context = ctx;
  const width = (font: string): number => {
    context.font = `40px ${font}`;
    return context.measureText(PROBE).width;
  };
  const bases = PROBE_BASES.map((generic) => [generic, width(generic)] as const);
  if (bases.every(([, w]) => w === 0)) return [];
  const out: string[] = [];
  for (const name of [...new Set(names)].slice(0, MAX_PROBED)) {
    if (bases.every(([generic, w]) => width(`${quote(name)}, ${generic}`) === w)) out.push(name);
  }
  return out;
}

/**
 * The look-alike a missing font is replaced with: the first entry of the fallback table for known
 * Office fonts, else a description of the generic family ("a serif font").
 */
export function substituteFor(name: string): string {
  const known = KNOWN[name.trim().toLowerCase()]?.alternatives[0];
  return known ?? `a ${guess(name.trim(), null).generic} font`;
}

const MAX_LISTED = 6;

/**
 * A quality note naming the fonts of `families` that `doc` lacks and their look-alikes (decisions-v1
 * F01), or null when every font is available or availability cannot be measured.
 */
export function fontSubstitutionNote(doc: Document, families: Iterable<string>): string | null {
  const missing = missingFonts(doc, families);
  if (missing.length === 0) return null;
  const listed = missing.slice(0, MAX_LISTED).map((name) => `${name} \u2192 ${substituteFor(name)}`);
  const more = missing.length > MAX_LISTED ? ` and ${missing.length - MAX_LISTED} more` : "";
  return `Fonts not installed on this device are shown with look-alikes (or the closest installed font): ${listed.join(", ")}${more}.`;
}

/**
 * The first concrete family of every font-family list in `css` (declarations and `--*-font` theme
 * variables), skipping generic families and var() references. Used to probe for missing fonts.
 */
export function primaryFamilies(css: string): string[] {
  const out = new Set<string>();
  const lists = css.matchAll(/(?:font-family|--[\w-]*font)\s*:\s*([^;}!]+)/gi);
  for (const match of lists) {
    const first = splitFamilies(match[1] ?? "")
      .map(unquote)
      .find((f) => f !== "" && !f.startsWith("var("));
    if (first && !GENERICS.has(first.toLowerCase())) out.add(first);
  }
  return [...out];
}
