/**
 * Document font stacks from the shared core table (contracts/decisions-v1.md F01, `FONT_FALLBACKS`
 * in @swarmloom/core). Each stack keeps the original name first, so an installed copy wins
 * (`local()` first), then the metric-compatible or look-alike open font, then a generic family.
 * No font files are bundled.
 */
import { cleanFontFamily, missingFonts, resolveFontFamily } from "@swarmloom/core";

/** CSS generic family that ends a stack. */
export type GenericFamily = "serif" | "sans-serif" | "monospace";

/** Result of {@link fontStack}. */
export interface FontChoice {
  /** CSS `font-family` value, already quoted. */
  stack: string;
  /** F01 substitute used when the original is missing (e.g. "Carlito" for Calibri). */
  substitute?: string;
  /** Clean original family name. */
  family: string;
}

/** Strips characters that could break out of a CSS string or declaration (core `cleanFontFamily`). */
export const cleanFamily: (name: string) => string = cleanFontFamily;

/**
 * A CSS font-family stack for a document font name, following the F01 table.
 *
 * @param name Family name as written in the document.
 * @param generic The document's own generic hint, used when the name is unknown.
 */
export function fontStack(name: string, generic?: GenericFamily): FontChoice {
  const family = cleanFamily(name);
  const { family: stack, substituted } = resolveFontFamily(family, generic);
  return substituted ? { stack, substitute: substituted, family } : { stack, family };
}

/**
 * Collects F01 substitutions while a document renders and words those the device needs (the
 * original face is not installed) as one quality note.
 */
export class FontReport {
  /** Lower-case family -> [family, substitute], first spelling wins. */
  private readonly substitutions = new Map<string, readonly [string, string]>();

  /** Returns the stack for `name` and remembers the substitution, if any. */
  use(name: string, generic?: GenericFamily): string {
    return this.useAll([name], generic);
  }

  /**
   * Stack for a run that names several fonts (Latin first, then East Asian): each family brings its
   * own fallbacks in order, then the CJK tail and the generic family of the first one.
   */
  useAll(names: readonly string[], generic?: GenericFamily): string {
    const families = names.map(cleanFamily).filter((n) => n !== "");
    for (const family of families) {
      const key = family.toLowerCase();
      const substitute = resolveFontFamily(family).substituted;
      if (substitute && substitute.toLowerCase() !== key && !this.substitutions.has(key)) {
        this.substitutions.set(key, [family, substitute]);
      }
    }
    return resolveFontFamily(families, families.length > 0 ? generic : (generic ?? "serif")).family;
  }

  /**
   * "Fonts shown with open substitutes when not installed: Calibri -> Carlito, ...", listing only the
   * faces `doc` cannot draw; undefined when there are none or availability cannot be measured.
   */
  note(doc: Document): string | undefined {
    const pairs = [...this.substitutions.values()];
    if (pairs.length === 0) return undefined;
    const families = pairs.map(([family]) => family);
    const missing = new Set(missingFonts(doc, families));
    const list = pairs
      .filter(([family]) => missing.has(family))
      .map(([family, substitute]) => `${family} -> ${substitute}`);
    return list.length > 0 ? `Fonts shown with open substitutes when not installed: ${list.join(", ")}.` : undefined;
  }
}
