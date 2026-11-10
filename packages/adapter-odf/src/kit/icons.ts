/**
 * Intro icon of a document format: our own folded-sheet tile in a brand colour with a short label
 * ("ODT", "EPUB"). Returned as a data: URL.
 */
export function documentIcon(label: string, color: string): string {
  const text = label
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  const size = text.length > 3 ? 11 : 13;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect x="4" y="4" width="56" height="56" rx="16" fill="${color}"/>` +
    '<path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#FFFFFF"/>' +
    `<path d="M37 14v9h9" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" opacity=".45"/>` +
    `<text x="31.5" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="${size}" fill="${color}">${text}</text>` +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
