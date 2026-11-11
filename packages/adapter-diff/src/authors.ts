import type { DiffAuthor, DiffCommit } from "./parse";

/** The agent label an author is shown as, with a stable colour. */
export interface AuthorLabel {
  /** Identity key: lower-case e-mail, else the name. */
  key: string;
  /** Name, or "Author n" when anonymised. */
  label: string;
  /** 0-based order of first appearance. */
  index: number;
  color: string;
}

/** Author chip colours: the SwarmLoom cursor palette, cycled. */
export const AUTHOR_COLORS = [
  "#5B5BF7",
  "#FF6B5B",
  "#14B8A6",
  "#F5A524",
  "#FF4F7B",
  "#7C5CF0",
  "#0EA5C6",
  "#3FA34D",
] as const;

function keyOf(author: DiffAuthor): string {
  return (author.email || author.name).trim().toLowerCase();
}

/**
 * Maps every distinct author to one label, in order of first appearance. With `anonymize`,
 * labels are "Author 1", "Author 2", ... and no name or e-mail leaves this function.
 */
export function labelAuthors(commits: readonly DiffCommit[], anonymize = false): Map<DiffCommit, AuthorLabel> {
  const byKey = new Map<string, AuthorLabel>();
  const out = new Map<DiffCommit, AuthorLabel>();
  for (const c of commits) {
    if (!c.author) continue;
    const key = keyOf(c.author);
    let label = byKey.get(key);
    if (!label) {
      const index = byKey.size;
      label = {
        key: anonymize ? `author-${index + 1}` : key,
        label: anonymize ? `Author ${index + 1}` : c.author.name,
        index,
        color: AUTHOR_COLORS[index % AUTHOR_COLORS.length] as string,
      };
      byKey.set(key, label);
    }
    out.set(c, label);
  }
  return out;
}
