import { isHtmlElement, viewOf } from "../dom/env";
import { parsePseudoContent } from "./pseudo-content";
import type { ElInfo, PseudoInfo } from "./state";

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

/** Generated ::before / ::after box of an element, or null when there is none (cached on the info). */
export function pseudoOf(info: ElInfo, which: "before" | "after"): PseudoInfo | null {
  const cached = info[which];
  if (cached !== undefined) return cached;
  let result: PseudoInfo | null = null;
  const el = info.el;
  if (isHtmlElement(el) && !NO_PSEUDO.has(el.localName)) {
    const cs = viewOf(el).getComputedStyle(el, `::${which}`);
    const content = cs.content;
    if (content && content !== "none" && content !== "normal" && cs.display !== "none") {
      const parsed = parsePseudoContent(content, (name) => el.getAttribute(name));
      if (parsed) {
        result = { cs, text: parsed.text, image: parsed.image, display: cs.display, position: cs.position };
      }
    }
  }
  info[which] = result;
  return result;
}

/** True when the pseudo-element flows inline with the host's content. */
export function isInlinePseudo(p: PseudoInfo): boolean {
  return p.position !== "absolute" && p.position !== "fixed" && (p.cs.cssFloat || "none") === "none";
}
