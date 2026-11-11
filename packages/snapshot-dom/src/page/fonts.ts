import { fontFamilies, rewriteUrls } from "../util/css";

/** Cap on the collected @font-face text. */
const CSS_BUDGET = 256 * 1024;
const FONT_FACE_RULE = 5;
const IMPORT_RULE = 3;
const MEDIA_RULE = 4;
const SUPPORTS_RULE = 12;
const LAYER_BLOCK_RULE = 18;

function collect(
  rules: CSSRuleList,
  base: string,
  families: ReadonlySet<string>,
  out: string[],
  depth: number,
  budget: { left: number },
): void {
  if (depth > 6) return;
  for (const rule of Array.from(rules)) {
    if (budget.left <= 0) return;
    if (rule.type === FONT_FACE_RULE) {
      const style = (rule as CSSFontFaceRule).style;
      const family = fontFamilies(style.getPropertyValue("font-family"))[0];
      if (!family || !families.has(family)) continue;
      const text = rewriteUrls(rule.cssText, (url) => {
        if (/^data:/i.test(url)) return url;
        try {
          return new URL(url, base).href;
        } catch {
          return null;
        }
      });
      budget.left -= text.length;
      if (budget.left >= 0) out.push(text);
    } else if (rule.type === IMPORT_RULE) {
      const sheet = (rule as CSSImportRule).styleSheet;
      if (sheet) collectSheet(sheet, families, out, depth + 1, budget);
    } else if (rule.type === MEDIA_RULE || rule.type === SUPPORTS_RULE || rule.type === LAYER_BLOCK_RULE) {
      collect((rule as CSSGroupingRule).cssRules, base, families, out, depth + 1, budget);
    }
  }
}

function collectSheet(
  sheet: CSSStyleSheet,
  families: ReadonlySet<string>,
  out: string[],
  depth: number,
  budget: { left: number },
): void {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    // Cross-origin style sheets cannot be read; their fonts stay available in the live page only.
    return;
  }
  const base = sheet.href ?? sheet.ownerNode?.baseURI ?? "";
  collect(rules, base, families, out, depth, budget);
}

/**
 * `@font-face` rules for the font families the captured text uses, from the document's and open
 * shadow roots' style sheets, with relative `src` URLs made absolute. De-duplicated.
 */
export function fontFaceCss(doc: Document, roots: Iterable<ShadowRoot>, families: ReadonlySet<string>): string {
  if (families.size === 0) return "";
  const out: string[] = [];
  const budget = { left: CSS_BUDGET };
  // A Set: web components adopt one shared sheet in every instance's shadow root, and reading its
  // rules once per root made this one unsliced task grow with roots x rules.
  const sheets = new Set<CSSStyleSheet>([...Array.from(doc.styleSheets), ...(doc.adoptedStyleSheets ?? [])]);
  for (const root of roots) {
    for (const sheet of Array.from(root.styleSheets)) sheets.add(sheet);
    for (const sheet of root.adoptedStyleSheets ?? []) sheets.add(sheet);
  }
  for (const sheet of sheets) collectSheet(sheet, families, out, 0, budget);
  return [...new Set(out)].join("\n");
}
