/**
 * Original file-type icon for the intro orbit: a folded sheet in Loom Indigo with text lines and a short
 * label ("DOCX", "DOC"). Returned as a data URL so it works in any document.
 */
export function documentIcon(label: string): string {
  const text = label
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 4h26l14 14v40a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" stroke="#5B5BF7" stroke-width="3" stroke-linejoin="round"/><path d="M40 4v12a2 2 0 0 0 2 2h12" fill="#E6E6FE" stroke="#5B5BF7" stroke-width="3" stroke-linejoin="round"/><path d="M20 26h24M20 33h24M20 40h16" stroke="#B9B9FB" stroke-width="3" stroke-linecap="round"/><rect x="8" y="44" width="36" height="14" rx="4" fill="#5B5BF7"/><text x="26" y="54.5" font-family="system-ui,sans-serif" font-size="9" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
