import { extensionOf, FORMAT_META, formatOfName } from "../formats-meta";

/**
 * One playable example, produced at build time from the repository's `examples/` folder.
 * Everything here is plain data: the gallery renders it with `textContent` only.
 */
export interface ExampleEntry {
  /** Stable URL id, used in `?example=<id>`. */
  id: string;
  /** Path relative to the examples folder, with forward slashes. */
  path: string;
  /** Adapter id from the format registry. */
  format: string;
  title: string;
  /** File size in bytes. */
  size: number;
  /** Content language from a `.zh.` / `.en.` style suffix; the gallery shows one variant per group. */
  lang?: string;
  /** Variants of the same example share a group (the path without the language suffix). */
  group: string;
  /** First lines of textual examples, for the CSS thumbnail. */
  snippet?: string;
  /** Path of a sibling poster image (`name.poster.webp` etc.), relative to the examples folder. */
  poster?: string;
}

export interface ExampleManifest {
  version: 1;
  entries: ExampleEntry[];
}

export const EMPTY_MANIFEST: ExampleManifest = { version: 1, entries: [] };

/** Gallery order: documents first, then visual formats, then models. */
export const FORMAT_ORDER: readonly string[] = [
  "markdown",
  "html",
  "docx",
  "doc",
  "pdf",
  "slides",
  "sheet",
  "svg",
  "code",
  "image",
  "three",
];

const LANG_SUFFIX = /\.(zh-cn|zh-tw|zh|en|ja|ko|es|fr|de)$/i;
const POSTER = /\.poster\.(webp|avif|png|jpe?g|svg)$/i;
/** Repository housekeeping that sits next to examples but is not one. */
const SKIP_NAME =
  /^(readme|sources|license|licence|notice|copying|changelog|attribution|package)(\.|$)|^(generate|gen-|make-)/i;
/** Copyright and licence notes of copied samples; they ship with the samples they cover. */
const NOTICE_NAME = /^(sources|license|licence|notice|copying|attribution)(\.|$)/i;
const SKIP_DIR = /^(\.|_|node_modules$|scripts$|tools$|src$)/i;

/** Largest example copied into the build; bigger files are skipped with a warning. */
export const MAX_EXAMPLE_BYTES = 8 * 1024 * 1024;

/**
 * True for files that are never listed (scripts, docs, dotfiles). None of them is copied into the
 * build either, except licence notes (see `isNotice`).
 */
export function isHousekeeping(path: string): boolean {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  if (parts.some((dir) => SKIP_DIR.test(dir))) return true;
  if (name.startsWith(".")) return true;
  return SKIP_NAME.test(name);
}

/**
 * True for copyright and licence notes (`SOURCES.md`, `LICENSE`, `NOTICE` ...): never listed, but
 * copied into the build so that third-party samples keep their attribution.
 */
export function isNotice(path: string): boolean {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  if (parts.some((dir) => SKIP_DIR.test(dir))) return false;
  return NOTICE_NAME.test(name);
}

/** Folders whose files support another example (images of a Markdown file, textures of a model). */
const ASSET_DIR = /^(assets?|images?|img|media|static|fonts?|textures?|files)$/i;

/**
 * True for files that ship with the build but are not listed: anything inside an asset folder below
 * the top level (top-level folders name formats, and `image/` is one), and every file of a page
 * folder (a folder with an `index.html`) except that `index.html`.
 */
export function isSupportingAsset(path: string, pageDirs: ReadonlySet<string>): boolean {
  const parts = path.split("/");
  parts.pop();
  if (parts.slice(1).some((dir) => ASSET_DIR.test(dir))) return true;
  for (let i = parts.length; i > 0; i--) {
    const dir = parts.slice(0, i).join("/");
    if (pageDirs.has(dir)) return path !== `${dir}/index.html`;
  }
  return false;
}

/** Page folders below the top level: folders that contain an `index.html`. */
export function pageDirsOf(paths: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    const match = /^(.+\/[^/]+)\/index\.html$/i.exec(p);
    if (match?.[1]) dirs.add(match[1]);
  }
  return dirs;
}

/** True for sibling poster images, which are thumbnails rather than examples. */
export function isPoster(path: string): boolean {
  return POSTER.test(path);
}

/** Strips the extension and the language suffix: "markdown/welcome.en.md" -> "markdown/welcome". */
export function groupOf(path: string): { group: string; lang?: string } {
  const ext = extensionOf(path);
  const stem = ext ? path.slice(0, -(ext.length + 1)) : path;
  const match = LANG_SUFFIX.exec(stem);
  if (!match?.[1]) return { group: stem };
  return { group: stem.slice(0, -match[0].length), lang: match[1].toLowerCase() };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** "loom-bot" -> "Loom bot" */
export function humanize(stem: string): string {
  const words = stem.replace(/[-_.]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : stem;
}

export interface ClassifiedFile {
  path: string;
  format: string;
  group: string;
  lang?: string;
}

/**
 * Classifies a path relative to the examples folder; null when it is not a playable example.
 * Source files count as examples only under `code/`: elsewhere they are sample generators or
 * metadata (`generate.py`, `attribution.json`).
 */
export function classifyExample(path: string): ClassifiedFile | null {
  if (isHousekeeping(path) || isPoster(path)) return null;
  const meta = formatOfName(path);
  if (!meta) return null;
  if (meta.id === "code" && !path.startsWith("code/")) return null;
  return { path, format: meta.id, ...groupOf(path) };
}

/** Assigns unique, URL-safe ids; colliding stems get their extension appended. */
export function assignIds(files: readonly ClassifiedFile[]): Map<string, string> {
  const stems = new Map<string, number>();
  const stemOf = (f: ClassifiedFile) => slug(f.path.slice(0, -(extensionOf(f.path).length + 1)));
  for (const f of files) stems.set(stemOf(f), (stems.get(stemOf(f)) ?? 0) + 1);
  const ids = new Map<string, string>();
  for (const f of files) {
    const stem = stemOf(f);
    ids.set(f.path, (stems.get(stem) ?? 0) > 1 ? slug(`${stem}-${extensionOf(f.path)}`) : stem);
  }
  return ids;
}

/** A listed example: its classification, gallery id and optional sibling poster. */
export interface PlannedExample extends ClassifiedFile {
  id: string;
  poster?: string;
}

/**
 * Picks the gallery entries among the files that ship (paths relative to the examples folder,
 * housekeeping and oversized files already removed): supporting assets, posters and licence
 * notes are not listed, and each poster attaches to the example it is named after.
 */
export function planExamples(shippable: readonly string[]): PlannedExample[] {
  const pageDirs = pageDirsOf(shippable);
  const classified = shippable
    .filter((p) => !isSupportingAsset(p, pageDirs))
    .map(classifyExample)
    .filter((c): c is ClassifiedFile => c !== null);
  const posters = new Map<string, string>();
  for (const p of shippable.filter(isPoster)) posters.set(p.replace(/\.poster\.[a-z]+$/i, ""), p);
  const ids = assignIds(classified);
  return classified.map((c) => {
    const ext = extensionOf(c.path);
    const poster = posters.get(c.path) ?? posters.get(ext ? c.path.slice(0, -(ext.length + 1)) : c.path);
    const planned: PlannedExample = { ...c, id: ids.get(c.path) ?? c.path };
    if (poster) planned.poster = poster;
    return planned;
  });
}

function orderOf(format: string): number {
  const index = FORMAT_ORDER.indexOf(format);
  return index < 0 ? FORMAT_ORDER.length : index;
}

/** Sorts entries for the gallery: by format order, then by path. */
export function sortEntries<T extends { format: string; path: string }>(entries: T[]): T[] {
  return entries.sort((a, b) => orderOf(a.format) - orderOf(b.format) || a.path.localeCompare(b.path, "en"));
}

/**
 * Picks one variant per group for the UI language: exact language, then English, then the first.
 * Entries without a language suffix are their own group and always shown.
 */
export function entriesForLocale(manifest: ExampleManifest, locale: string): ExampleEntry[] {
  const language = locale.toLowerCase();
  const base = language.split("-")[0] ?? language;
  const groups = new Map<string, ExampleEntry[]>();
  for (const entry of manifest.entries) {
    const list = groups.get(entry.group);
    if (list) list.push(entry);
    else groups.set(entry.group, [entry]);
  }
  const picked: ExampleEntry[] = [];
  for (const variants of groups.values()) {
    const choice =
      variants.find((v) => v.lang === language) ??
      variants.find((v) => v.lang === base) ??
      variants.find((v) => v.lang === "en") ??
      variants.find((v) => v.lang === undefined) ??
      variants[0];
    if (choice) picked.push(choice);
  }
  return sortEntries(picked);
}

/** Every format id Studio knows, for drift checks against the registry. */
export const KNOWN_FORMATS: readonly string[] = FORMAT_META.map((m) => m.id);

/** Validates a manifest from an untrusted place (fetched JSON); invalid entries are dropped. */
export function sanitizeManifest(raw: unknown): ExampleManifest {
  if (typeof raw !== "object" || raw === null) return EMPTY_MANIFEST;
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return EMPTY_MANIFEST;
  const valid = entries.filter((e): e is ExampleEntry => {
    if (typeof e !== "object" || e === null) return false;
    const r = e as Record<string, unknown>;
    return (
      typeof r.id === "string" &&
      typeof r.path === "string" &&
      !r.path.includes("..") &&
      typeof r.format === "string" &&
      KNOWN_FORMATS.includes(r.format) &&
      typeof r.title === "string" &&
      typeof r.size === "number" &&
      typeof r.group === "string"
    );
  });
  return { version: 1, entries: valid };
}
