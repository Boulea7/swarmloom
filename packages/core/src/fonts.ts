/**
 * Shared document font fallbacks (contracts/decisions-v1.md F01, integration-notes item 14).
 *
 * Office and OpenDocument files name typefaces that most machines lack (Calibri, SimSun, MS Gothic).
 * Each stack keeps the document's own face first, so an installed copy wins (the Studio's `local()`
 * path), then other names of the same face, then the open metric-compatible substitute named in F01,
 * then look-alikes, CJK fallbacks and a generic family. No font files are bundled.
 *
 * Pure data and string functions: no DOM, safe in workers and Node.
 */

/** CSS generic family that ends a stack. */
export type GenericFontFamily = "serif" | "sans-serif" | "monospace" | "cursive" | "fantasy";

/** One entry of {@link FONT_FALLBACKS}. */
export interface FontFallback {
  /** Open font from the F01 table shown when the face is missing; reported as the substitution. */
  substitute?: string;
  /** Other names of the very same face (localised or English), tried right after the document's name. */
  aliases?: readonly string[];
  /** Platform faces that look alike, tried after the substitute. */
  similar?: readonly string[];
  generic: "serif" | "sans-serif" | "monospace";
}

/** Result of {@link resolveFontFamily}. */
export interface ResolvedFontFamily {
  /** CSS `font-family` value, quoted where needed and safe to put in a declaration. */
  family: string;
  /** F01 substitute of the first face (e.g. "Carlito" for Calibri); absent when it has none. */
  substituted?: string;
}

type Generic = FontFallback["generic"];

const entry = (generic: Generic, substitute?: string, similar: readonly string[] = []): FontFallback =>
  substitute ? { substitute, similar, generic } : { similar, generic };
/** The same face under its other name, sharing the fallbacks of `base`. */
const alias = (base: FontFallback, ...aliases: string[]): FontFallback => ({ ...base, aliases });

const SERIF_SC = entry("serif", "Noto Serif SC", ["Songti SC", "STSong", "Noto Serif CJK SC"]);
const SANS_SC = entry("sans-serif", "Noto Sans SC", ["PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC"]);
const KAI_SC = entry("serif", "Noto Serif SC", ["Kaiti SC", "STKaiti"]);
const FANG_SC = entry("serif", "Noto Serif SC", ["STFangsong"]);
const SERIF_TC = entry("serif", "Noto Serif TC", ["Songti TC", "Noto Serif CJK TC"]);
const KAI_TC = entry("serif", "Noto Serif TC", ["Kaiti TC"]);
const SANS_TC = entry("sans-serif", "Noto Sans TC", ["PingFang TC", "Heiti TC", "Noto Sans CJK TC"]);
const SERIF_JP = entry("serif", "Noto Serif JP", ["Hiragino Mincho ProN", "Noto Serif CJK JP"]);
const SANS_JP = entry("sans-serif", "Noto Sans JP", ["Hiragino Sans", "Noto Sans CJK JP"]);
const SERIF_KR = entry("serif", "Noto Serif KR", ["AppleMyungjo", "Noto Serif CJK KR"]);
const SANS_KR = entry("sans-serif", "Noto Sans KR", ["Apple SD Gothic Neo", "Noto Sans CJK KR"]);

/**
 * Fallbacks per document face, keyed by lower-case family name. Faces with a `substitute` follow
 * F01: Calibri -> Carlito, Cambria -> Caladea, Arial/Helvetica -> Liberation Sans, Times New Roman ->
 * Liberation Serif, Courier New -> Liberation Mono, SimSun -> Noto Serif SC, Microsoft YaHei/SimHei
 * -> Noto Sans SC, and the matching Noto faces for Traditional Chinese, Japanese and Korean. Common
 * faces without an open metric twin only bring look-alikes and are never reported.
 */
export const FONT_FALLBACKS: Readonly<Record<string, FontFallback>> = Object.freeze({
  calibri: entry("sans-serif", "Carlito", ["Segoe UI", "Helvetica Neue", "Arial"]),
  "calibri light": entry("sans-serif", "Carlito", ["Segoe UI Light", "Helvetica Neue", "Arial"]),
  cambria: entry("serif", "Caladea", ["Georgia", "Times New Roman"]),
  arial: entry("sans-serif", "Liberation Sans", ["Arimo", "Helvetica Neue", "Helvetica"]),
  helvetica: entry("sans-serif", "Liberation Sans", ["Helvetica Neue", "Arial", "Arimo"]),
  "times new roman": entry("serif", "Liberation Serif", ["Tinos", "Times"]),
  times: alias(entry("serif", "Liberation Serif", ["Tinos"]), "Times New Roman"),
  "courier new": entry("monospace", "Liberation Mono", ["Cousine", "Courier"]),
  courier: alias(entry("monospace", "Liberation Mono", ["Cousine"]), "Courier New"),
  aptos: entry("sans-serif", undefined, ["Segoe UI", "Helvetica Neue", "Arial"]),
  "segoe ui": entry("sans-serif", undefined, ["Helvetica Neue", "Ubuntu", "Arial"]),
  tahoma: entry("sans-serif", undefined, ["Verdana", "DejaVu Sans", "Arial"]),
  verdana: entry("sans-serif", undefined, ["DejaVu Sans", "Tahoma", "Arial"]),
  "trebuchet ms": entry("sans-serif", undefined, ["Segoe UI", "Arial"]),
  "century gothic": entry("sans-serif", undefined, ["Avenir", "URW Gothic", "Arial"]),
  georgia: entry("serif", undefined, ["Gelasio", "Times New Roman"]),
  garamond: entry("serif", undefined, ["EB Garamond", "Georgia"]),
  "book antiqua": entry("serif", undefined, ["Palatino Linotype", "Palatino", "Georgia"]),
  consolas: entry("monospace", undefined, ["Menlo", "Monaco", "Liberation Mono"]),
  "lucida console": entry("monospace", undefined, ["Menlo", "Monaco", "Liberation Mono"]),
  // Simplified Chinese.
  simsun: SERIF_SC,
  宋体: alias(SERIF_SC, "SimSun"),
  nsimsun: alias(SERIF_SC, "SimSun"),
  新宋体: alias(SERIF_SC, "NSimSun", "SimSun"),
  stsong: SERIF_SC,
  华文宋体: alias(SERIF_SC, "STSong"),
  simhei: SANS_SC,
  黑体: alias(SANS_SC, "SimHei"),
  "microsoft yahei": SANS_SC,
  微软雅黑: alias(SANS_SC, "Microsoft YaHei"),
  dengxian: SANS_SC,
  等线: alias(SANS_SC, "DengXian"),
  kaiti: KAI_SC,
  楷体: alias(KAI_SC, "KaiTi"),
  kaiti_gb2312: alias(KAI_SC, "KaiTi"),
  楷体_gb2312: alias(KAI_SC, "KaiTi_GB2312", "KaiTi"),
  stkaiti: KAI_SC,
  fangsong: FANG_SC,
  仿宋: alias(FANG_SC, "FangSong"),
  fangsong_gb2312: alias(FANG_SC, "FangSong"),
  仿宋_gb2312: alias(FANG_SC, "FangSong_GB2312", "FangSong"),
  // Traditional Chinese.
  pmingliu: SERIF_TC,
  新細明體: alias(SERIF_TC, "PMingLiU"),
  mingliu: SERIF_TC,
  細明體: alias(SERIF_TC, "MingLiU"),
  "dfkai-sb": KAI_TC,
  標楷體: alias(KAI_TC, "DFKai-SB"),
  "microsoft jhenghei": SANS_TC,
  微軟正黑體: alias(SANS_TC, "Microsoft JhengHei"),
  // Japanese.
  "ms mincho": SERIF_JP,
  "ｍｓ 明朝": alias(SERIF_JP, "MS Mincho"),
  "ms pmincho": SERIF_JP,
  "ｍｓ ｐ明朝": alias(SERIF_JP, "MS PMincho"),
  "yu mincho": SERIF_JP,
  游明朝: alias(SERIF_JP, "Yu Mincho"),
  "ms gothic": SANS_JP,
  "ｍｓ ゴシック": alias(SANS_JP, "MS Gothic"),
  "ms pgothic": SANS_JP,
  "ｍｓ ｐゴシック": alias(SANS_JP, "MS PGothic"),
  meiryo: SANS_JP,
  メイリオ: alias(SANS_JP, "Meiryo"),
  "yu gothic": SANS_JP,
  游ゴシック: alias(SANS_JP, "Yu Gothic"),
  // Korean.
  batang: SERIF_KR,
  바탕: alias(SERIF_KR, "Batang"),
  gungsuh: SERIF_KR,
  "malgun gothic": SANS_KR,
  "맑은 고딕": alias(SANS_KR, "Malgun Gothic"),
  gulim: SANS_KR,
  굴림: alias(SANS_KR, "Gulim"),
  dotum: SANS_KR,
  돋움: alias(SANS_KR, "Dotum"),
});

/** Last-resort CJK faces per generic family, so mixed Latin and CJK runs never fall to tofu. */
const CJK_TAIL: Readonly<Record<GenericFontFamily, readonly string[]>> = {
  serif: ["Noto Serif SC", "Noto Serif CJK SC", "Songti SC"],
  "sans-serif": ["Noto Sans SC", "Noto Sans CJK SC", "PingFang SC"],
  monospace: ["Noto Sans Mono CJK SC", "Noto Sans SC"],
  cursive: ["Noto Sans SC", "Noto Sans CJK SC", "PingFang SC"],
  fantasy: ["Noto Sans SC", "Noto Sans CJK SC", "PingFang SC"],
};

/** Names CSS reads as keywords (generic families, CSS-wide values); a face with such a name is quoted. */
const KEYWORDS =
  /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-[a-z-]+|inherit|initial|unset|revert|revert-layer|default)$/i;
const MAX_NAME = 80;
const MONO_HINT = /mono|courier|consol|code/i;
const SANS_HINT = /sans|gothic|hei|黑|gulim|dotum|yahei|雅黑|ゴシック|고딕/i;
const SERIF_HINT = /serif|song|宋|ming|明|mincho|kai|楷|fang|仿|times|roman|garamond|georgia|batang|바탕/i;

/**
 * A family name made safe for a CSS declaration: quotes, backslashes, separators, brackets and
 * control characters are dropped, whitespace is collapsed and the name is capped at 80 characters.
 */
export function cleanFontFamily(name: string): string {
  return (
    String(name)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are dropped on purpose.
      .replace(/["'\\;,{}()<>\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME)
      .trim()
  );
}

function quote(name: string): string {
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(name) && !KEYWORDS.test(name) ? name : `"${name}"`;
}

function guessGeneric(name: string): Generic {
  if (MONO_HINT.test(name)) return "monospace";
  if (SANS_HINT.test(name)) return "sans-serif";
  return SERIF_HINT.test(name) ? "serif" : "sans-serif";
}

/**
 * Joins family names into a CSS `font-family` value: each name is cleaned ({@link cleanFontFamily}),
 * empty and repeated names (case-insensitive) are dropped, names are quoted where CSS needs it, and
 * `generic` ends the list when given.
 */
export function formatFontFamily(names: readonly string[], generic?: GenericFontFamily): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = cleanFontFamily(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(quote(name));
  }
  if (generic) out.push(generic);
  return out.join(", ");
}

const cache = new Map<string, ResolvedFontFamily>();
const MAX_CACHED = 512;

/**
 * CSS `font-family` value for one document face, or for a run that names several (Latin first,
 * then East Asian): each face brings its aliases, F01 substitute and look-alikes in that order, then
 * come CJK fallbacks and a generic family. The generic family is the table's for known faces, else
 * `generic` (the document's own hint), else a guess from the name.
 *
 * @param name Face name as written in the document, or several faces of one run.
 * @param generic Generic family the document states for the first face, when known.
 * @returns `family` (the CSS value) and `substituted`, the F01 substitute of the first face.
 */
export function resolveFontFamily(name: string | readonly string[], generic?: GenericFontFamily): ResolvedFontFamily {
  const faces = (typeof name === "string" ? [name] : name).map(cleanFontFamily).filter((n) => n !== "");
  const key = `${faces.join("\u0000")}\u0001${generic ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const names: string[] = [];
  let first: Generic | GenericFontFamily | undefined;
  let substituted: string | undefined;
  faces.forEach((face, i) => {
    const known = FONT_FALLBACKS[face.toLowerCase()];
    if (i === 0) {
      first = known?.generic ?? generic ?? guessGeneric(face);
      substituted = known?.substitute;
    }
    names.push(face, ...(known?.aliases ?? []));
    if (known?.substitute) names.push(known.substitute);
    names.push(...(known?.similar ?? []));
  });
  const gen = first ?? generic ?? "sans-serif";
  const result: ResolvedFontFamily = {
    family: formatFontFamily([...names, ...CJK_TAIL[gen]], gen),
    ...(substituted ? { substituted } : {}),
  };
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(key, Object.freeze(result));
  return result;
}
