import type { Adapter } from "@swarmloom/core";

/** Static metadata of a format (everything but the adapter code). */
export interface FormatMeta {
  /** Adapter id; equals `Adapter.id` of the adapter the entry loads. */
  id: string;
  label: string;
  /** Lower-case file extensions without the dot. */
  extensions: string[];
  /** Lower-case MIME types without parameters. */
  mime: string[];
  /** Optional extra content check for formats the built-in signature table does not know. */
  sniff?(head: Uint8Array, name?: string): boolean;
}

/** Static metadata of a format plus a lazy loader for its adapter. */
export interface FormatEntry extends FormatMeta {
  /** Imports the adapter on demand (one chunk per format). */
  loader: () => Promise<Adapter>;
}

/**
 * Builds a registry from {@link FORMAT_META} with a custom adapter loader, for example one that
 * imports adapter chunks from a CDN.
 */
export function createRegistry(loader: (id: string) => Promise<Adapter>): FormatEntry[] {
  return FORMAT_META.map((meta) => ({ ...meta, loader: () => loader(meta.id) }));
}

/**
 * Detection metadata for every adapter id. Keep in sync with each adapter package;
 * test/formats.browser.test.ts checks every entry.
 */
export const FORMAT_META: readonly FormatMeta[] = [
  {
    id: "dom",
    label: "Web page",
    extensions: [],
    mime: [],
  },
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    mime: ["text/markdown", "text/x-markdown"],
  },
  {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm", "xhtml"],
    mime: ["text/html", "application/xhtml+xml"],
  },
  {
    id: "docx",
    label: "Word document",
    extensions: ["docx"],
    mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  {
    id: "doc",
    label: "Word 97-2003 document",
    extensions: ["doc"],
    mime: ["application/msword"],
  },
  {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    mime: ["application/pdf"],
  },
  {
    id: "svg",
    label: "SVG",
    extensions: ["svg"],
    mime: ["image/svg+xml"],
  },
  {
    id: "slides",
    label: "Presentation",
    extensions: ["pptx", "ppt", "odp"],
    mime: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
      "application/vnd.oasis.opendocument.presentation",
    ],
  },
  {
    id: "sheet",
    label: "Spreadsheet",
    extensions: ["xlsx", "xlsm", "xls", "ods", "csv", "tsv"],
    mime: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.spreadsheet",
      "text/csv",
      "text/tab-separated-values",
    ],
  },
  {
    id: "code",
    label: "Source code",
    extensions: [
      "txt",
      "js",
      "mjs",
      "cjs",
      "jsx",
      "ts",
      "mts",
      "cts",
      "tsx",
      "json",
      "css",
      "scss",
      "less",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "kt",
      "swift",
      "c",
      "h",
      "cc",
      "cpp",
      "hpp",
      "cs",
      "php",
      "sh",
      "bash",
      "zsh",
      "sql",
      "yaml",
      "yml",
      "toml",
      "xml",
      "vue",
      "svelte",
      "lua",
      "dart",
      "scala",
    ],
    mime: [
      "text/plain",
      "text/javascript",
      "application/javascript",
      "application/json",
      "text/css",
      "application/typescript",
      "text/x-python",
      "text/x-c",
      "text/x-java-source",
      "application/xml",
      "text/xml",
      "application/x-sh",
      "application/toml",
      "application/yaml",
    ],
  },
  {
    id: "image",
    label: "Image",
    extensions: ["png", "apng", "jpg", "jpeg", "jfif", "gif", "webp", "avif", "bmp"],
    mime: ["image/png", "image/apng", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"],
  },
  {
    id: "three",
    label: "3D model",
    extensions: ["glb", "gltf", "obj", "stl", "ply"],
    mime: [
      "model/gltf-binary",
      "model/gltf+json",
      "model/obj",
      "model/stl",
      "model/x.stl-binary",
      "model/x.stl-ascii",
      "application/sla",
      "application/vnd.ms-pki.stl",
      "model/x-ply",
      "application/ply",
    ],
  },
];
