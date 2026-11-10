/**
 * Copies `text` to the clipboard.
 *
 * Tries the async Clipboard API first (secure contexts; must run inside the click handler for
 * iOS Safari), then the legacy `execCommand("copy")` on `field`, which also leaves the text
 * selected so the user can copy it by hand when both fail.
 *
 * @param field Read-only text field holding the same text. On fallback it is revealed (its
 *   enclosing `<details>` opens), focused and selected.
 * @returns Whether the text reached the clipboard.
 */
export async function copyText(text: string, field: HTMLTextAreaElement): Promise<boolean> {
  const clipboard = field.ownerDocument.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Denied or unavailable (insecure context, permissions policy): try the legacy path.
    }
  }
  const details = field.closest("details");
  if (details) details.open = true;
  field.focus({ preventScroll: true });
  field.select();
  field.setSelectionRange(0, field.value.length);
  try {
    // Deprecated but still the only synchronous fallback, notably for older WebViews.
    return field.ownerDocument.execCommand("copy");
  } catch {
    return false;
  }
}
