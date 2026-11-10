/**
 * @swarmloom/adapter-diff: patches woven as code-review panels. Context lines appear, removed
 * lines are struck and deleted, added lines are typed; each author is one agent label.
 */

export { createDiffAdapter, DEFAULT_MAX_BYTES, type DiffAdapterOptions, diffAdapter } from "./adapter";
export { AUTHOR_COLORS, type AuthorLabel, labelAuthors } from "./authors";
export { buildDiffBlueprint, type DiffLayoutOptions, diffIcon, MONO_FONT, measureMono } from "./layers";
export {
  type DiffAuthor,
  type DiffCommit,
  DiffError,
  type DiffFile,
  type DiffLine,
  decodeHeader,
  type FileStatus,
  type Hunk,
  type LineKind,
  looksLikePatch,
  type ParsedPatch,
  type ParseOptions,
  type PatchKind,
  parseAuthor,
  parsePatch,
} from "./parse";
export { createDiffPlugin, DIFF_PLUGIN, type DiffLineData, diffPlugin, LINE_TASK, readLineData } from "./plugin";
