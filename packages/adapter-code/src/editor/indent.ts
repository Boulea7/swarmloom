/** A vertical indent guide: drawn at `col` for lines `from..to` (inclusive, 0-based). */
export interface IndentGuide {
  col: number;
  from: number;
  to: number;
}

/** Number of leading spaces (tabs must already be expanded). */
export function leadingSpaces(text: string): number {
  let n = 0;
  while (n < text.length && text.charCodeAt(n) === 32) n++;
  return n;
}

/**
 * Indent unit of a file: the smallest positive indent of a non-blank line, clamped to 1..8.
 * Returns 0 when no line is indented.
 */
export function indentUnit(indents: readonly (number | null)[]): number {
  let unit = 0;
  for (const n of indents) if (n !== null && n > 0 && (unit === 0 || n < unit)) unit = n;
  return unit === 0 ? 0 : Math.min(8, unit);
}

/**
 * Computes editor-style indent guides. `indents[i]` is the indent of line i, or null for a blank
 * line; blank lines take the smaller indent of their nearest non-blank neighbours so guides run
 * through them. Runs shorter than `minRun` lines are dropped; at most `maxGuides` are returned,
 * shallow levels first.
 */
export function indentGuides(
  indents: readonly (number | null)[],
  opts: { maxLevels?: number; minRun?: number; maxGuides?: number } = {},
): IndentGuide[] {
  const unit = indentUnit(indents);
  if (unit === 0) return [];
  const maxLevels = opts.maxLevels ?? 8;
  const minRun = opts.minRun ?? 2;
  const maxGuides = opts.maxGuides ?? 120;

  const effective = fillBlankIndents(indents);
  const guides: IndentGuide[] = [];
  for (let level = 0; level < maxLevels; level++) {
    const col = level * unit;
    let start = -1;
    for (let i = 0; i <= effective.length; i++) {
      const inside = i < effective.length && (effective[i] ?? 0) > col;
      if (inside && start === -1) start = i;
      if (!inside && start !== -1) {
        if (i - start >= minRun) guides.push({ col, from: start, to: i - 1 });
        if (guides.length >= maxGuides) return guides;
        start = -1;
      }
    }
  }
  return guides;
}

function fillBlankIndents(indents: readonly (number | null)[]): number[] {
  const n = indents.length;
  const next: number[] = new Array(n).fill(0);
  let after = 0;
  for (let i = n - 1; i >= 0; i--) {
    const v = indents[i];
    if (v !== null && v !== undefined) after = v;
    next[i] = after;
  }
  const out: number[] = new Array(n).fill(0);
  let before = 0;
  for (let i = 0; i < n; i++) {
    const v = indents[i];
    if (v !== null && v !== undefined) {
      before = v;
      out[i] = v;
    } else {
      out[i] = Math.min(before, next[i] ?? 0);
    }
  }
  return out;
}
