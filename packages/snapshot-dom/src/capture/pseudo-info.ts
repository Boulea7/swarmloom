import { counterReader } from "./counters";
import { parsePseudoContent } from "./pseudo-content";
import { pseudoStyleOf } from "./pseudo-style";
import type { Capture, ElInfo, PseudoInfo } from "./state";

/** Generated ::before / ::after box of an element, or null when there is none (cached on the info). */
export function pseudoOf(cap: Capture, info: ElInfo, which: "before" | "after"): PseudoInfo | null {
  const cached = info[which];
  if (cached !== undefined) return cached;
  let result: PseudoInfo | null = null;
  const cs = pseudoStyleOf(info, which);
  if (cs) {
    const el = info.el;
    const content = cs.content;
    const counter = content.includes("counter") ? counterReader(cap, el, which) : undefined;
    const parsed = parsePseudoContent(content, (name) => el.getAttribute(name), counter);
    if (parsed) {
      result = { cs, text: parsed.text, image: parsed.image, display: cs.display, position: cs.position };
    }
  }
  info[which] = result;
  return result;
}

/** True when the pseudo-element flows inline with the host's content. */
export function isInlinePseudo(p: PseudoInfo): boolean {
  return p.position !== "absolute" && p.position !== "fixed" && (p.cs.cssFloat || "none") === "none";
}
