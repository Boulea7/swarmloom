/**
 * Shared font fallback table (contracts/decisions-v1.md F01). Documents name fonts that most machines
 * lack (Calibri, SimSun, ...). Each stack keeps the original name first, so an installed copy wins
 * (`local()` first), then the metric-compatible or look-alike open font, then a generic family.
 * No font files are bundled.
 */

/** CSS generic family that ends a stack. */
export type GenericFamily = "serif" | "sans-serif" | "monospace";

interface Fallback {
  /** The open font named in F01; reported as the substitute. */
  substitute: string;
  /** Other names of the same face (localised names, platform look-alikes) tried before the substitute. */
  aliases: readonly string[];
  generic: GenericFamily;
}

const f = (substitute: string, generic: GenericFamily, ...aliases: string[]): Fallback => ({
  substitute,
  aliases,
  generic,
});

const SERIF_SC = f("Noto Serif SC", "serif", "SimSun", "宋体", "Songti SC", "STSong", "Noto Serif CJK SC");
const SANS_SC = f("Noto Sans SC", "sans-serif", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC");
const KAI_SC = f("Noto Serif SC", "serif", "KaiTi", "楷体", "Kaiti SC", "STKaiti");
const FANG_SC = f("Noto Serif SC", "serif", "FangSong", "仿宋", "STFangsong");
const SERIF_TC = f("Noto Serif TC", "serif", "PMingLiU", "新細明體", "Songti TC", "Noto Serif CJK TC");
const SANS_TC = f("Noto Sans TC", "sans-serif", "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC");
const SERIF_JP = f("Noto Serif JP", "serif", "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP");
const SANS_JP = f("Noto Sans JP", "sans-serif", "Yu Gothic", "Hiragino Sans", "Noto Sans CJK JP");
const SERIF_KR = f("Noto Serif KR", "serif", "Batang", "AppleMyungjo", "Noto Serif CJK KR");
const SANS_KR = f("Noto Sans KR", "sans-serif", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR");

/** Keys are lower-case family names. */
const TABLE: Record<string, Fallback> = {
  calibri: f("Carlito", "sans-serif"),
  "calibri light": f("Carlito", "sans-serif"),
  cambria: f("Caladea", "serif"),
  arial: f("Liberation Sans", "sans-serif", "Arimo", "Helvetica"),
  helvetica: f("Liberation Sans", "sans-serif", "Helvetica Neue", "Arial", "Arimo"),
  "times new roman": f("Liberation Serif", "serif", "Tinos", "Times"),
  times: f("Liberation Serif", "serif", "Times New Roman", "Tinos"),
  "courier new": f("Liberation Mono", "monospace", "Cousine", "Courier"),
  courier: f("Liberation Mono", "monospace", "Courier New", "Cousine"),
  simsun: SERIF_SC,
  宋体: SERIF_SC,
  nsimsun: SERIF_SC,
  新宋体: SERIF_SC,
  stsong: SERIF_SC,
  华文宋体: SERIF_SC,
  kaiti: KAI_SC,
  楷体: KAI_SC,
  kaiti_gb2312: KAI_SC,
  楷体_gb2312: KAI_SC,
  stkaiti: KAI_SC,
  fangsong: FANG_SC,
  仿宋: FANG_SC,
  fangsong_gb2312: FANG_SC,
  仿宋_gb2312: FANG_SC,
  simhei: SANS_SC,
  黑体: SANS_SC,
  "microsoft yahei": SANS_SC,
  微软雅黑: SANS_SC,
  dengxian: SANS_SC,
  等线: SANS_SC,
  pmingliu: SERIF_TC,
  mingliu: SERIF_TC,
  新細明體: SERIF_TC,
  細明體: SERIF_TC,
  "dfkai-sb": SERIF_TC,
  標楷體: SERIF_TC,
  "microsoft jhenghei": SANS_TC,
  微軟正黑體: SANS_TC,
  "ms mincho": SERIF_JP,
  "ms pmincho": SERIF_JP,
  "ｍｓ 明朝": SERIF_JP,
  "yu mincho": SERIF_JP,
  游明朝: SERIF_JP,
  "ms gothic": SANS_JP,
  "ms pgothic": SANS_JP,
  "ｍｓ ゴシック": SANS_JP,
  meiryo: SANS_JP,
  メイリオ: SANS_JP,
  "yu gothic": SANS_JP,
  游ゴシック: SANS_JP,
  batang: SERIF_KR,
  바탕: SERIF_KR,
  gungsuh: SERIF_KR,
  "malgun gothic": SANS_KR,
  "맑은 고딕": SANS_KR,
  gulim: SANS_KR,
  굴림: SANS_KR,
  dotum: SANS_KR,
  돋움: SANS_KR,
};

/** Last-resort CJK faces per generic family, so mixed Latin/CJK runs never fall to tofu. */
const CJK_TAIL: Record<GenericFamily, readonly string[]> = {
  serif: ["Noto Serif SC", "Noto Serif CJK SC", "Songti SC"],
  "sans-serif": ["Noto Sans SC", "Noto Sans CJK SC", "PingFang SC"],
  monospace: ["Noto Sans Mono CJK SC", "Noto Sans SC"],
};

const GENERICS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

/** Result of {@link fontStack}. */
export interface FontChoice {
  /** CSS `font-family` value, already quoted. */
  stack: string;
  /** F01 substitute used when the original is missing (e.g. "Carlito" for Calibri). */
  substitute?: string;
  /** Clean original family name. */
  family: string;
}

/** Strips characters that could break out of a CSS string or declaration. */
export function cleanFamily(name: string): string {
  return (
    name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are dropped on purpose.
      .replace(/["'\\;{}()<>\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
  );
}

function quote(name: string): string {
  return GENERICS.has(name) ? name : `"${name}"`;
}

function guessGeneric(name: string): GenericFamily {
  const n = name.toLowerCase();
  if (/mono|courier|consol|code/.test(n)) return "monospace";
  if (/sans|gothic|hei|黑|gulim|dotum|yahei|雅黑/.test(n)) return "sans-serif";
  if (/serif|song|宋|ming|明|mincho|kai|楷|fang|仿|times|roman|garamond|georgia|batang/.test(n)) return "serif";
  return "sans-serif";
}

interface Family {
  names: string[];
  generic: GenericFamily;
  substitute?: string;
  family: string;
}

function familyNames(name: string, generic?: GenericFamily): Family {
  const family = cleanFamily(name);
  const known = TABLE[family.toLowerCase()];
  const gen = known?.generic ?? generic ?? guessGeneric(family);
  const names = [family, ...(known?.aliases ?? []), ...(known ? [known.substitute] : [])].filter(
    (n) => n !== "" && !GENERICS.has(n.toLowerCase()),
  );
  return known ? { names, generic: gen, substitute: known.substitute, family } : { names, generic: gen, family };
}

function compose(names: readonly string[], generic: GenericFamily): string {
  return [...new Set([...names, ...CJK_TAIL[generic]])].map(quote).concat(generic).join(", ");
}

/**
 * A CSS font-family stack for a document font name, following the F01 table.
 *
 * @param name Family name as written in the document.
 * @param generic The document's own generic hint, used when the name is unknown.
 */
export function fontStack(name: string, generic?: GenericFamily): FontChoice {
  const f = familyNames(name, generic);
  const stack = compose(f.names, f.generic);
  return f.substitute ? { stack, substitute: f.substitute, family: f.family } : { stack, family: f.family };
}

/** Collects F01 substitutions while a document renders and words them as one quality note. */
export class FontReport {
  /** Lower-case family -> "Family -> Substitute", first spelling wins. */
  private readonly substitutions = new Map<string, string>();

  /** Returns the stack for `name` and remembers the substitution, if any. */
  use(name: string, generic?: GenericFamily): string {
    return this.useAll([name], generic);
  }

  /**
   * Stack for a run that names several fonts (Latin first, then East Asian): each family brings its
   * own fallbacks in order, then the CJK tail and the generic family of the first one.
   */
  useAll(names: readonly string[], generic?: GenericFamily): string {
    const families = names.map((n, i) => familyNames(n, i === 0 ? generic : undefined)).filter((f) => f.family !== "");
    for (const f of families) {
      const key = f.family.toLowerCase();
      if (f.substitute && f.substitute.toLowerCase() !== key && !this.substitutions.has(key)) {
        this.substitutions.set(key, `${f.family} -> ${f.substitute}`);
      }
    }
    const gen = families[0]?.generic ?? generic ?? "serif";
    return compose(
      families.flatMap((f) => f.names),
      gen,
    );
  }

  /** "Fonts shown with open substitutes when not installed: Calibri -> Carlito, ...", or undefined. */
  note(): string | undefined {
    if (this.substitutions.size === 0) return undefined;
    const list = [...this.substitutions.values()].join(", ");
    return `Fonts shown with open substitutes when not installed: ${list}.`;
  }
}
