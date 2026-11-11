import { missingFonts, resolveFontFamily } from "@swarmloom/core";

/**
 * Office typefaces mapped to open stand-ins through the shared core table (decisions-v1 F01,
 * `FONT_FALLBACKS` in @swarmloom/core), so text keeps its line breaks on systems without the
 * Microsoft originals, plus a log of the faces a document actually used, so substitutions are
 * reported instead of silent, and only on devices that lack the original face.
 */

/** CSS `font-family` list for the given typefaces (Latin first), with open fallbacks and a generic family. */
export function fontStack(...typefaces: (string | undefined)[]): string {
  return resolveFontFamily(typefaces.filter((face): face is string => !!face)).family;
}

/** Open substitute reported for an Office face, or undefined when the face has none. */
export function fontSubstitute(face: string): string | undefined {
  return resolveFontFamily(face).substituted;
}

/** Characters that East Asian typefaces (`a:ea`) are used for. */
const CJK = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

/** True when `text` contains CJK characters (so the East Asian face is the one shown). */
export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

/**
 * Records the typefaces of visible text while a document is converted, and turns those with
 * an open substitute that the device cannot draw into one user-facing quality note.
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

  /**
   * "Calibri → Carlito" pairs in first-use order, for the faces `doc` cannot draw (an installed
   * original is shown as is). Empty when font availability cannot be measured.
   */
  substitutions(doc: Document): string[] {
    const pairs: [string, string][] = [];
    for (const name of this.faces.values()) {
      const alt = fontSubstitute(name);
      if (alt) pairs.push([name, alt]);
    }
    const faces = pairs.map(([name]) => name);
    const missing = new Set(missingFonts(doc, faces));
    return pairs.filter(([name]) => missing.has(name)).map(([name, alt]) => `${name} → ${alt}`);
  }

  /** Quality note listing the substitutions on `doc`, or undefined when there are none. */
  note(doc: Document): string | undefined {
    const pairs = this.substitutions(doc);
    if (pairs.length === 0) return undefined;
    return `Fonts that are not installed are shown with open substitutes: ${pairs.join(", ")}.`;
  }
}
