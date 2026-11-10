import { h } from "./dom";
import { cursorGlyph } from "./icons";

/** Cursor palette from contracts/brand.md, cycled across agents (order matters). */
export const CURSOR_PALETTE = [
  "#5B5BF7",
  "#FF6B5B",
  "#14B8A6",
  "#F5A524",
  "#D946EF",
  "#3BA7F5",
  "#84CC16",
  "#9B5CF6",
  "#F43F5E",
  "#0EA5E9",
  "#22C55E",
  "#FB923C",
] as const;

/**
 * A decorative cursor with a name tag, like the ones that build the content. Purely visual
 * (`aria-hidden`); the caller positions it with CSS.
 */
export function decorCursor(name: string, color: string, className = ""): HTMLElement {
  const el = h(
    "span",
    { class: `decor-cursor ${className}`.trim(), attrs: { "aria-hidden": "true" } },
    cursorGlyph(color, 22),
    h("span", { class: "decor-cursor-tag", text: name }),
  );
  el.style.setProperty("--cursor", color);
  return el;
}
