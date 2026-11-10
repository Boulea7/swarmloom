const TEXT_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const ATTR_ESCAPES: Record<string, string> = { ...TEXT_ESCAPES, '"': "&quot;", "'": "&#39;" };

/** Escapes text for use between HTML tags. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => TEXT_ESCAPES[c] ?? c);
}

/** Escapes text for use inside a quoted HTML attribute value. */
export function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ATTR_ESCAPES[c] ?? c);
}
