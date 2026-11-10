import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import {
  EMPTY_MANIFEST,
  type ExampleEntry,
  type ExampleManifest,
  groupOf,
  humanize,
  isHousekeeping,
  MAX_EXAMPLE_BYTES,
  planExamples,
  sortEntries,
} from "../src/examples/manifest";
import { formatOfName } from "../src/formats-meta";

export const EXAMPLES_MODULE = "virtual:studio-examples";
const RESOLVED = `\0${EXAMPLES_MODULE}`;

const SNIPPET_BYTES = 2048;
const SNIPPET_LINES = 18;
const TITLE_LIMIT = 80;

/** Formats whose thumbnails are drawn from a text snippet (SVG and HTML render themselves). */
const SNIPPET_FORMATS = new Set(["markdown", "code", "sheet"]);

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    if (entry.isDirectory()) {
      if (!isHousekeeping(`${rel}/x`)) walk(full, root, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function clean(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_LIMIT);
}

/** Best-effort title from the content of text formats; falls back to the file name. */
export function titleOf(format: string, text: string | null, group: string): string {
  const fallback = humanize(group.split("/").pop() ?? group);
  if (!text) return fallback;
  let found: string | undefined;
  if (format === "markdown") {
    const heading = /^#{1,2}\s+(.+?)\s*#*\s*$/m.exec(text)?.[1];
    found = heading?.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "");
  } else if (format === "html") {
    found =
      /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(text)?.[1] ?? /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i.exec(text)?.[1];
  } else if (format === "svg") {
    found = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(text)?.[1];
  }
  const title = found ? clean(found) : "";
  return title || fallback;
}

/** First lines of a text example, trimmed for a thumbnail. */
export function snippetOf(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(0, SNIPPET_LINES)
    .map((line) => line.replace(/\t/g, "  ").slice(0, 120))
    .join("\n")
    .trimEnd();
}

function readHead(file: string, bytes: number): string {
  const buffer = readFileSync(file);
  return new TextDecoder("utf-8").decode(buffer.subarray(0, Math.min(buffer.length, bytes)));
}

export interface ScanResult {
  manifest: ExampleManifest;
  /** Relative paths to copy into the build (examples, posters and their supporting assets). */
  files: string[];
  /** Human-readable reasons for skipped files. */
  warnings: string[];
}

/** Scans an examples folder into a manifest plus the list of files to ship. */
export function scanExamples(root: string): ScanResult {
  if (!existsSync(root)) return { manifest: EMPTY_MANIFEST, files: [], warnings: [] };
  const all: string[] = [];
  walk(root, root, all);
  all.sort();
  const warnings: string[] = [];
  const sizes = new Map(all.map((p) => [p, statSync(join(root, p)).size]));
  const shippable = all.filter((p) => {
    if (isHousekeeping(p)) return false;
    const size = sizes.get(p) ?? 0;
    if (size > MAX_EXAMPLE_BYTES) {
      warnings.push(`${p} is larger than ${MAX_EXAMPLE_BYTES} bytes and was skipped`);
      return false;
    }
    // Source files outside code/ are generators, not assets.
    return !(formatOfName(p)?.id === "code" && !p.startsWith("code/"));
  });

  const entries: ExampleEntry[] = planExamples(shippable).map((c) => {
    const meta = formatOfName(c.path);
    const text = meta?.textual && sizes.get(c.path) ? readHead(join(root, c.path), 64 * 1024) : null;
    const entry: ExampleEntry = {
      id: c.id,
      path: c.path,
      format: c.format,
      title: titleOf(c.format, text, groupOf(c.path).group),
      size: sizes.get(c.path) ?? 0,
      group: c.group,
    };
    if (c.lang) entry.lang = c.lang;
    if (text && SNIPPET_FORMATS.has(c.format)) entry.snippet = snippetOf(text.slice(0, SNIPPET_BYTES));
    if (c.poster) entry.poster = c.poster;
    return entry;
  });
  return { manifest: { version: 1, entries: sortEntries(entries) }, files: shippable, warnings };
}

const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

export interface ExamplesPluginOptions {
  /** Absolute path of the examples folder. */
  dir: string;
  /** When false the manifest is empty and nothing is copied (extension builds). */
  include: boolean;
}

/**
 * Exposes the examples manifest as `virtual:studio-examples`, serves example files in dev and
 * copies them to `<outDir>/examples/` in builds.
 */
export function examplesPlugin(options: ExamplesPluginOptions): Plugin {
  const root = resolve(options.dir);
  let scan: ScanResult = { manifest: EMPTY_MANIFEST, files: [], warnings: [] };
  let base = "/";
  const rescan = (): ScanResult => {
    scan = options.include ? scanExamples(root) : { manifest: EMPTY_MANIFEST, files: [], warnings: [] };
    return scan;
  };

  return {
    name: "swarmloom-studio-examples",
    configResolved(config) {
      base = config.base;
    },
    buildStart() {
      for (const warning of rescan().warnings) this.warn(warning);
      if (options.include && existsSync(root)) this.addWatchFile(root);
    },
    resolveId(id) {
      return id === EXAMPLES_MODULE ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return `export default ${JSON.stringify(scan.manifest)};`;
    },
    configureServer(server) {
      if (!options.include) return;
      server.watcher.add(root);
      const invalidate = (file: string) => {
        if (!resolve(file).startsWith(root)) return;
        rescan();
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
      server.watcher.on("change", invalidate);
      const prefix = `${base.replace(/\/?$/, "/")}examples/`;
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        let rel: string;
        try {
          rel = decodeURIComponent(url.slice(prefix.length));
        } catch {
          return next();
        }
        if (!scan.files.includes(rel)) return next();
        const file = resolve(root, rel);
        if (!file.startsWith(root + sep)) return next();
        res.setHeader("Content-Type", MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const rel of scan.files) {
        this.emitFile({ type: "asset", fileName: `examples/${rel}`, source: readFileSync(join(root, rel)) });
      }
    },
  };
}
