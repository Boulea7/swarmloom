/**
 * Patch parser: plain unified diffs, git diffs (extended headers, renames, binary markers),
 * `git log -p` output and `git format-patch` mailboxes. Hunk bodies are read by their line
 * counts, so content lines that look like headers ("--- ", "diff ") are never misread.
 */

/** Thrown when the input is not a patch this parser understands. */
export class DiffError extends Error {
  override name = "DiffError";
}

export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  /** Line content without the leading marker and line break. */
  text: string;
  /** 1-based line number in the old file (context and removed lines). */
  oldNo?: number;
  /** 1-based line number in the new file (context and added lines). */
  newNo?: number;
  /** Followed by "\ No newline at end of file". */
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Section heading after the second `@@` (often the enclosing function). */
  section: string;
  lines: DiffLine[];
  /** The input ended before the hunk's line counts were reached. */
  incomplete?: boolean;
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "copied";

export interface DiffFile {
  /** Path before the change; null for added files. */
  oldPath: string | null;
  /** Path after the change; null for deleted files. */
  newPath: string | null;
  status: FileStatus;
  binary: boolean;
  /** Similarity of a rename or copy, percent. */
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  hunks: Hunk[];
}

export interface DiffAuthor {
  name: string;
  email?: string;
}

export interface DiffCommit {
  /** Commit hash when known (log -p, format-patch). */
  id?: string;
  author?: DiffAuthor;
  /** Date as written in the source. */
  date?: string;
  subject?: string;
  /** Message body below the subject. */
  body?: string;
  files: DiffFile[];
}

export type PatchKind = "unified" | "git" | "log" | "mbox";

export interface ParsedPatch {
  kind: PatchKind;
  commits: DiffCommit[];
  /** Lines or files dropped because of limits. */
  dropped: number;
}

export interface ParseOptions {
  /** Most files kept. Default 300. */
  maxFiles?: number;
  /** Most hunk lines kept over all files. Default 20 000. */
  maxLines?: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const MBOX_FROM = /^From [0-9a-f]{7,64} /;
const LOG_COMMIT = /^commit ([0-9a-f]{7,64})\b/;
const MAX_LINE = 10_000;

/** Decodes a git C-style quoted path ("a/sp\303\244ce"). */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path;
  const bytes: number[] = [];
  const body = path.slice(1, -1);
  const enc = new TextEncoder();
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '"': 34, "\\": 92 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c !== "\\") {
      bytes.push(...enc.encode(c));
      continue;
    }
    const next = body[i + 1] ?? "";
    const oct = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (oct) {
      bytes.push(Number.parseInt(oct[0], 8) & 255);
      i += 3;
    } else if (next in simple) {
      bytes.push(simple[next] as number);
      i += 1;
    } else bytes.push(92);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Strips the `a/` / `b/` prefix, a trailing timestamp, and maps /dev/null to null. */
function cleanPath(raw: string, prefix: "a/" | "b/"): string | null {
  let p = raw.replace(/\r$/, "");
  if (!p.startsWith('"')) {
    const tab = p.indexOf("\t");
    if (tab >= 0) p = p.slice(0, tab);
  }
  p = unquote(p.trim());
  if (p === "/dev/null") return null;
  if (p.startsWith(prefix)) p = p.slice(2);
  return p || null;
}

/** Splits the `diff --git a/x b/y` paths (quoted or not; ambiguous spaces resolved by equal halves). */
function gitPaths(rest: string): [string | null, string | null] {
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|.+)$/.exec(rest);
  if (rest.startsWith('"') || rest.endsWith('"')) {
    if (quoted) return [cleanPath(quoted[1] as string, "a/"), cleanPath(quoted[2] as string, "b/")];
  }
  // "a/<p> b/<p>": when both halves are the same path the split is unambiguous.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.startsWith("a/") && rest.slice(half + 1).startsWith("b/")) {
    const a = rest.slice(2, half);
    const b = rest.slice(half + 3);
    if (a === b) return [a, b];
  }
  const idx = rest.indexOf(" b/");
  if (idx > 0) return [cleanPath(rest.slice(0, idx), "a/"), cleanPath(rest.slice(idx + 1), "b/")];
  return [null, null];
}

/** RFC 2047 encoded words (=?UTF-8?q?...?= and =?UTF-8?b?...?=) as written by git format-patch. */
export function decodeHeader(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        let bytes: Uint8Array;
        if (enc.toLowerCase() === "b") {
          const bin = atob(text);
          bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        } else {
          const out: number[] = [];
          const s = text.replace(/_/g, " ");
          for (let i = 0; i < s.length; i++) {
            const hex = s[i] === "=" ? /^[0-9a-fA-F]{2}/.exec(s.slice(i + 1, i + 3)) : null;
            if (hex) {
              out.push(Number.parseInt(hex[0], 16));
              i += 2;
            } else out.push(s.charCodeAt(i) & 255);
          }
          bytes = new Uint8Array(out);
        }
        return new TextDecoder(charset.toLowerCase() === "utf-8" ? "utf-8" : "latin1").decode(bytes);
      } catch {
        return text;
      }
    });
}

/** "Name <mail@host>" -> author. */
export function parseAuthor(value: string): DiffAuthor | undefined {
  const v = decodeHeader(value).trim();
  if (!v) return undefined;
  const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(v);
  if (!m) return { name: v.replace(/^"|"$/g, "") };
  const name = (m[1] as string).replace(/^"|"$/g, "").trim();
  const email = (m[2] as string).trim();
  return { name: name || email, ...(email ? { email } : {}) };
}

function newFile(): DiffFile {
  return { oldPath: null, newPath: null, status: "modified", binary: false, hunks: [] };
}

/**
 * Parses a patch.
 *
 * @throws DiffError when the input is binary or contains no file changes.
 */
export function parsePatch(source: string, options: ParseOptions = {}): ParsedPatch {
  if (typeof source !== "string") throw new DiffError("diff: expected text");
  if (source.includes("\u0000")) throw new DiffError("diff: the input is binary data, not a text patch");
  const maxFiles = Math.max(1, options.maxFiles ?? 300);
  const maxLines = Math.max(1, options.maxLines ?? 20_000);
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let kind: PatchKind = "unified";
  const commits: DiffCommit[] = [];
  let commit: DiffCommit | null = null;
  let file: DiffFile | null = null;
  let fromGitHeader = false;
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let kept = 0;
  let dropped = 0;
  let skipFiles = false;
  /** After a message's patch ends (signature line) until the next message. */
  let ignoreRest = false;

  const ensureCommit = (): DiffCommit => {
    if (!commit) {
      commit = { files: [] };
      commits.push(commit);
    }
    return commit;
  };
  const closeHunk = (): void => {
    if (hunk && (oldLeft > 0 || newLeft > 0)) hunk.incomplete = true;
    hunk = null;
    oldLeft = 0;
    newLeft = 0;
  };
  const startFile = (git: boolean): DiffFile | null => {
    closeHunk();
    const c = ensureCommit();
    const total = commits.reduce((n, k) => n + k.files.length, 0);
    if (total >= maxFiles) {
      skipFiles = true;
      dropped++;
      file = null;
      return null;
    }
    skipFiles = false;
    file = newFile();
    fromGitHeader = git;
    c.files.push(file);
    return file;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.length > MAX_LINE ? raw.slice(0, MAX_LINE) : raw;

    // Inside a hunk: the counts decide what is content.
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const h: Hunk = hunk;
      const mark = line.charAt(0);
      let entry: DiffLine | null = null;
      if (mark === " " || (line === "" && oldLeft > 0 && newLeft > 0)) {
        entry = { kind: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ };
        oldLeft--;
        newLeft--;
      } else if (mark === "-" && oldLeft > 0) {
        entry = { kind: "del", text: line.slice(1), oldNo: oldNo++ };
        oldLeft--;
      } else if (mark === "+" && newLeft > 0) {
        entry = { kind: "add", text: line.slice(1), newNo: newNo++ };
        newLeft--;
      } else if (mark === "\\") {
        const last = h.lines[h.lines.length - 1];
        if (last) last.noNewline = true;
        continue;
      } else {
        // A line that cannot belong to the hunk: the patch was cut. Re-read it as a header.
        closeHunk();
        i--;
        continue;
      }
      if (kept < maxLines) {
        h.lines.push(entry);
        kept++;
      } else dropped++;
      continue;
    }
    if (hunk && line.startsWith("\\")) {
      const last = (hunk as Hunk).lines[(hunk as Hunk).lines.length - 1];
      if (last) last.noNewline = true;
      continue;
    }
    if (hunk) closeHunk();

    if (MBOX_FROM.test(line)) {
      kind = "mbox";
      ignoreRest = false;
      file = null;
      commit = { id: (line.split(" ")[1] as string).slice(0, 64), files: [] };
      commits.push(commit);
      // RFC 822 headers up to the first blank line, with folded continuation lines.
      const headers: [string, string][] = [];
      for (i++; i < lines.length && lines[i] !== ""; i++) {
        const h = lines[i] as string;
        if (/^\s/.test(h) && headers.length > 0) {
          const lastHeader = headers[headers.length - 1] as [string, string];
          lastHeader[1] += ` ${h.trim()}`;
        } else {
          const colon = h.indexOf(":");
          if (colon > 0) headers.push([h.slice(0, colon).toLowerCase(), h.slice(colon + 1).trim()]);
        }
      }
      const c: DiffCommit = commit;
      for (const [name, value] of headers) {
        if (name === "from") {
          const author = parseAuthor(value);
          if (author) c.author = author;
        } else if (name === "date") c.date = value;
        else if (name === "subject") c.subject = decodeHeader(value).replace(/^\[[^\]]*\]\s*/, "");
      }
      // Message body up to the "---" separator.
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const b = lines[i] as string;
        if (b === "---" || b.startsWith("diff --git ") || b.startsWith("Index: ")) break;
        body.push(b);
      }
      if (lines[i] !== "---") i--;
      const text = body.join("\n").trim();
      if (text) c.body = text;
      continue;
    }
    if (ignoreRest) continue;

    const logMatch = LOG_COMMIT.exec(line);
    if (logMatch && (kind === "unified" || kind === "git" || kind === "log")) {
      kind = "log";
      file = null;
      commit = { id: logMatch[1] as string, files: [] };
      commits.push(commit);
      const c: DiffCommit = commit;
      for (i++; i < lines.length; i++) {
        const h = lines[i] as string;
        if (h === "") break;
        if (h.startsWith("Author:")) {
          const author = parseAuthor(h.slice(7));
          if (author) c.author = author;
        } else if (h.startsWith("Date:")) c.date = h.slice(5).trim();
      }
      const message: string[] = [];
      for (i++; i < lines.length; i++) {
        const m = lines[i] as string;
        if (m.startsWith("    ")) message.push(m.slice(4));
        else if (m === "" && (lines[i + 1] ?? "").startsWith("    ")) message.push("");
        else break;
      }
      i--;
      const [subject, ...rest] = message;
      if (subject?.trim()) c.subject = subject.trim();
      const body = rest.join("\n").trim();
      if (body) c.body = body;
      continue;
    }

    if (line.startsWith("diff --git ")) {
      if (kind === "unified") kind = "git";
      const f = startFile(true);
      if (f) {
        const [a, b] = gitPaths(line.slice(11));
        f.oldPath = a;
        f.newPath = b;
      }
      continue;
    }
    if (kind === "mbox" && line === "-- ") {
      // Signature separator: the rest of this message is the git version.
      ignoreRest = true;
      continue;
    }

    // `file` is reassigned inside closures, which control-flow narrowing does not see.
    const f = file as DiffFile | null;
    if (f && fromGitHeader && f.hunks.length === 0) {
      if (line.startsWith("new file mode ")) {
        f.status = "added";
        f.newMode = line.slice(14).trim();
        f.oldPath = null;
        continue;
      }
      if (line.startsWith("deleted file mode ")) {
        f.status = "deleted";
        f.oldMode = line.slice(18).trim();
        f.newPath = null;
        continue;
      }
      if (line.startsWith("old mode ")) {
        f.oldMode = line.slice(9).trim();
        continue;
      }
      if (line.startsWith("new mode ")) {
        f.newMode = line.slice(9).trim();
        continue;
      }
      if (line.startsWith("similarity index ")) {
        f.similarity = Number.parseInt(line.slice(17), 10) || 0;
        continue;
      }
      if (line.startsWith("rename from ") || line.startsWith("copy from ")) {
        f.status = line.startsWith("rename") ? "renamed" : "copied";
        f.oldPath = unquote(line.slice(line.indexOf("from ") + 5));
        continue;
      }
      if (line.startsWith("rename to ") || line.startsWith("copy to ")) {
        f.newPath = unquote(line.slice(line.indexOf("to ") + 3));
        continue;
      }
      if (line.startsWith("index ") || line.startsWith("dissimilarity index ")) continue;
      if (line.startsWith("Binary files ") || line === "GIT binary patch") {
        f.binary = true;
        if (line === "GIT binary patch") {
          // Skip the literal/delta blocks up to the next header.
          while (
            i + 1 < lines.length &&
            !/^(?:diff --git |From [0-9a-f]{7,64} |commit [0-9a-f]{7,64}|-- $)/.test(lines[i + 1] as string)
          )
            i++;
        }
        continue;
      }
    }

    if (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
      const reuse = f !== null && fromGitHeader && f.hunks.length === 0;
      const target = reuse ? f : startFile(false);
      i++;
      if (target) {
        const a = cleanPath(line.slice(4), "a/");
        const b = cleanPath((lines[i] as string).slice(4), "b/");
        if (!reuse) {
          target.oldPath = a;
          target.newPath = b;
        } else if (target.status !== "renamed" && target.status !== "copied") {
          // The ---/+++ lines resolve paths with spaces that the git header leaves ambiguous.
          if (a) target.oldPath = a;
          if (b) target.newPath = b;
        }
        if (a === null && b !== null) {
          target.status = "added";
          target.oldPath = null;
        } else if (b === null && a !== null) {
          target.status = "deleted";
          target.newPath = null;
        }
      }
      continue;
    }

    const hm = HUNK.exec(line);
    if (hm) {
      if (skipFiles) {
        const skip = Number(hm[2] ?? 1) + Number(hm[4] ?? 1);
        dropped += skip;
        continue;
      }
      const target = f ?? startFile(false);
      if (!target) continue;
      const h: Hunk = {
        oldStart: Number(hm[1]),
        oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: Number(hm[3]),
        newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        section: (hm[5] ?? "").trim(),
        lines: [],
      };
      target.hunks.push(h);
      hunk = h;
      oldLeft = h.oldLines;
      newLeft = h.newLines;
      oldNo = h.oldStart || 1;
      newNo = h.newStart || 1;
      if (h.oldLines === 0) oldNo = h.oldStart + 1;
      if (h.newLines === 0) newNo = h.newStart + 1;
    }
    // Anything else (preamble, diffstat, commit messages of plain diffs) is ignored.
  }
  closeHunk();

  for (const c of commits) {
    for (const f of c.files) {
      if (f.status === "modified" && f.oldPath && f.newPath && f.oldPath !== f.newPath) f.status = "renamed";
      if (!f.oldPath && !f.newPath) f.newPath = "(unknown file)";
    }
  }
  const files = commits.reduce((n, c) => n + c.files.length, 0);
  if (files === 0) throw new DiffError("diff: no file changes found (expected a unified diff, git patch or mailbox)");
  return { kind, commits: commits.filter((c) => c.files.length > 0 || c.subject), dropped };
}

/** Heuristic content check used for format sniffing: a diff header in the first lines. */
export function looksLikePatch(head: string): boolean {
  const text = head.replace(/^\uFEFF/, "");
  if (
    /^(?:diff --git |From [0-9a-f]{7,64} |commit [0-9a-f]{7,64}\b)/m.test(text) &&
    /^(?:diff --git |--- |@@ )/m.test(text)
  )
    return true;
  return /^--- [^\n]*\n\+\+\+ [^\n]*\n@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text);
}
