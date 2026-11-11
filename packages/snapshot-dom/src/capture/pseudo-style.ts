import { isHtmlElement, viewOf } from "../dom/env";
import type { ElInfo } from "./state";

/** Elements whose ::before/::after never render (replaced content and form controls). */
const NO_PSEUDO: ReadonlySet<string> = new Set([
  "img",
  "input",
  "select",
  "textarea",
  "video",
  "canvas",
  "iframe",
  "embed",
  "object",
  "audio",
  "br",
  "wbr",
  "option",
  "progress",
  "meter",
]);

/**
 * Computed style of the ::before / ::after box an element generates, or null when it generates
 * none. Memoised on the info: the counter pass and the walk share one read per pseudo-element.
 */
export function pseudoStyleOf(info: ElInfo, which: "before" | "after"): CSSStyleDeclaration | null {
  info.pseudoStyles ??= {};
  const memo = info.pseudoStyles;
  const cached = memo[which];
  if (cached !== undefined) return cached;
  let style: CSSStyleDeclaration | null = null;
  const el = info.el;
  if (isHtmlElement(el) && !NO_PSEUDO.has(el.localName)) {
    const cs = viewOf(el).getComputedStyle(el, `::${which}`);
    const content = cs.content;
    if (content && content !== "none" && content !== "normal" && cs.display !== "none") style = cs;
  }
  memo[which] = style;
  return style;
}
