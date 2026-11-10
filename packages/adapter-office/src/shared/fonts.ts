/**
 * Office typefaces mapped to open stand-ins (contracts/decisions-v1.md F01), so text keeps its
 * line breaks on systems without the Microsoft originals, plus a log of the faces a document
 * actually used, so substitutions are reported instead of silent.
 *
 * The table mirrors the shared fallback table planned for @swarmloom/formats; that package
 * imports this one lazily, so it cannot be imported back here without a dependency cycle.
 */

/** Open stand-ins per Office face (keys lower-case). The first entry is the reported substitute. */
const FONT_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  calibri: ["Carlito"],
  "calibri light": ["Carlito"],
  cambria: ["Caladea"],
  arial: ["Liberation Sans", "Arimo", "Helvetica"],
  helvetica: ["Liberation Sans", "Arial"],
  "times new roman": ["Liberation Serif", "Tinos", "Times"],
  "courier new": ["Liberation Mono", "Cousine", "Courier"],
  // Simplified Chinese.
  simsun: ["Noto Serif SC", "Songti SC"],
  宋体: ["Noto Serif SC", "Songti SC"],
  nsimsun: ["Noto Serif SC", "Songti SC"],
  新宋体: ["Noto Serif SC", "Songti SC"],
  "microsoft yahei": ["Noto Sans SC", "PingFang SC"],
  微软雅黑: ["Noto Sans SC", "PingFang SC"],
  simhei: ["Noto Sans SC", "PingFang SC"],
  黑体: ["Noto Sans SC", "PingFang SC"],
  dengxian: ["Noto Sans SC", "PingFang SC"],
  等线: ["Noto Sans SC", "PingFang SC"],
  // Traditional Chinese.
  pmingliu: ["Noto Serif TC", "Songti TC"],
  新細明體: ["Noto Serif TC", "Songti TC"],
  mingliu: ["Noto Serif TC", "Songti TC"],
  細明體: ["Noto Serif TC", "Songti TC"],
  "microsoft jhenghei": ["Noto Sans TC", "PingFang TC"],
  微軟正黑體: ["Noto Sans TC", "PingFang TC"],
  // Japanese.
  "ms mincho": ["Noto Serif JP", "Hiragino Mincho ProN"],
  "ms pmincho": ["Noto Serif JP", "Hiragino Mincho ProN"],
  "ｍｓ 明朝": ["Noto Serif JP", "Hiragino Mincho ProN"],
  "yu mincho": ["Noto Serif JP", "Hiragino Mincho ProN"],
  "ms gothic": ["Noto Sans JP", "Hiragino Sans"],
  "ms pgothic": ["Noto Sans JP", "Hiragino Sans"],
  "ｍｓ ゴシック": ["Noto Sans JP", "Hiragino Sans"],
  meiryo: ["Noto Sans JP", "Hiragino Sans"],
  メイリオ: ["Noto Sans JP", "Hiragino Sans"],
  "yu gothic": ["Noto Sans JP", "Hiragino Sans"],
  游ゴシック: ["Noto Sans JP", "Hiragino Sans"],
  // Korean.
  batang: ["Noto Serif KR", "AppleMyungjo"],
  바탕: ["Noto Serif KR", "AppleMyungjo"],
  "malgun gothic": ["Noto Sans KR", "Apple SD Gothic Neo"],
  "맑은 고딕": ["Noto Sans KR", "Apple SD Gothic Neo"],
  gulim: ["Noto Sans KR", "Apple SD Gothic Neo"],
  굴림: ["Noto Sans KR", "Apple SD Gothic Neo"],
  dotum: ["Noto Sans KR", "Apple SD Gothic Neo"],
  돋움: ["Noto Sans KR", "Apple SD Gothic Neo"],
  // UI faces without an open metric twin.
  "segoe ui": ["system-ui"],
  aptos: ["system-ui"],
};

const MONO_HINT = /mono|courier|consol|code/i;
const SERIF_HINT = /serif|times|georgia|cambria|garamond|minion|song|ming|mincho|batang|宋|明|바탕/i;

function quoteFamily(name: string): string {
  return /^[a-z-]+$/i.test(name) && name !== "inherit" ? name : `"${name.replace(/["\\]/g, "")}"`;
}

/** CSS `font-family` list for the given typefaces, with open fallbacks and a generic family. */
export function fontStack(...typefaces: (string | undefined)[]): string {
  const names: string[] = [];
  const push = (n: string) => {
    if (n && !names.includes(n)) names.push(n);
  };
  for (const face of typefaces) {
    if (!face) continue;
    push(face);
    for (const alt of FONT_FALLBACKS[face.toLowerCase()] ?? []) push(alt);
  }
  const first = typefaces.find(Boolean) ?? "";
  if (MONO_HINT.test(first)) push("monospace");
  else if (SERIF_HINT.test(first) && !/sans|gothic|ゴシック|고딕/i.test(first)) push("serif");
  else {
    push("system-ui");
    push("sans-serif");
  }
  return names.map(quoteFamily).join(", ");
}

/** Open substitute reported for an Office face, or undefined when the face has none. */
export function fontSubstitute(face: string): string | undefined {
  const alt = FONT_FALLBACKS[face.trim().toLowerCase()]?.[0];
  return alt && alt !== "system-ui" ? alt : undefined;
}

/** Characters that East Asian typefaces (`a:ea`) are used for. */
const CJK = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

/** True when `text` contains CJK characters (so the East Asian face is the one shown). */
export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

/**
 * Records the typefaces of visible text while a document is converted, and turns those with
 * an open substitute into one user-facing quality note.
 */
export class FontLog {
  private readonly faces = new Map<string, string>();

  /** Records a typeface that is shown (case-insensitive; the first spelling seen is kept). */
  add(face: string | undefined): void {
    const name = face?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!this.faces.has(key)) this.faces.set(key, name);
  }

  /** "Calibri → Carlito" pairs in first-use order. */
  substitutions(): string[] {
    const out: string[] = [];
    for (const name of this.faces.values()) {
      const alt = fontSubstitute(name);
      if (alt) out.push(`${name} → ${alt}`);
    }
    return out;
  }

  /** Quality note listing the substitutions, or undefined when there are none. */
  note(): string | undefined {
    const pairs = this.substitutions();
    if (pairs.length === 0) return undefined;
    return `Fonts that are not installed are shown with open substitutes: ${pairs.join(", ")}.`;
  }
}
