const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Removes C0 controls (except tab, LF, CR) and lone surrogates that would corrupt generated markup. */
export function cleanText(text: string): string {
  return text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
    "",
  );
}

/** Builds an attribute list from defined values: `attrs({ class: "a", title: undefined })` -> ` class="a"`. */
export function attrs(values: Record<string, string | number | undefined | null | false>): string {
  let out = "";
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    out += ` ${name}="${escapeHtml(String(value))}"`;
  }
  return out;
}
