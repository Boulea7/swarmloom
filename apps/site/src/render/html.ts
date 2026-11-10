/**
 * String helpers for the build-time renderer. Every interpolated text goes through {@link esc};
 * markup produced by the renderer itself is trusted.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for use in element content and double- or single-quoted attributes. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Formats a number for SVG attributes: at most two decimals, no trailing zeros. */
export function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Serializes CSS custom properties for a `style` attribute (`--x:12;--y:3`). */
export function cssVars(vars: Record<string, number | string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `--${key}:${typeof value === "number" ? num(value) : value}`)
    .join(";");
}
