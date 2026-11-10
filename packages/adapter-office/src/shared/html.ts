import type { CSSMap } from "@swarmloom/core";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for use in HTML content or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Serialises declarations for a `style="..."` attribute (values are escaped, empty ones skipped). */
export function styleAttr(css: CSSMap): string {
  let out = "";
  for (const [prop, value] of Object.entries(css)) {
    if (value === "") continue;
    out += `${prop}:${value};`;
  }
  return escapeHtml(out);
}

/** Rounds a pixel value to 2 decimals for compact, stable output. */
export function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

/** Rounds to 2 decimals. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
