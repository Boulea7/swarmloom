import type { Adapter } from "@swarmloom/core";

/** Static metadata of a format plus a lazy loader for its adapter. */
export interface FormatEntry {
  /** Adapter id; equals `Adapter.id` of what `loader` resolves to. */
  id: string;
  label: string;
  /** Lower-case file extensions without the dot. */
  extensions: string[];
  /** Lower-case MIME types without parameters. */
  mime: string[];
  /** Optional extra content check for formats the built-in magic table does not know. */
  sniff?(head: Uint8Array, name?: string): boolean;
  /** Imports the adapter on demand (one chunk per format). */
  loader: () => Promise<Adapter>;
}

// Keep metadata in sync with each adapter package; test/formats.test.ts checks it.
export const formats: FormatEntry[] = [
  {
    id: "dom",
    label: "Web page",
    extensions: [],
    mime: [],
    loader: () => import("@swarmloom/snapshot-dom").then((m) => m.domAdapter),
  },
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    mime: ["text/markdown", "text/x-markdown"],
    loader: () => import("@swarmloom/adapter-markdown").then((m) => m.markdownAdapter),
  },
  {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm", "xhtml"],
    mime: ["text/html", "application/xhtml+xml"],
    loader: () => import("@swarmloom/adapter-html").then((m) => m.htmlAdapter),
  },
  {
    id: "docx",
    label: "Word document",
    extensions: ["docx"],
    mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    loader: () => import("@swarmloom/adapter-docx").then((m) => m.docxAdapter),
  },
  {
    id: "doc",
    label: "Word 97-2003 document",
    extensions: ["doc"],
    mime: ["application/msword"],
    loader: () => import("@swarmloom/adapter-doc").then((m) => m.docAdapter),
  },
  {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    mime: ["application/pdf"],
    loader: () => import("@swarmloom/adapter-pdf").then((m) => m.pdfAdapter),
  },
  {
    id: "svg",
    label: "SVG",
    extensions: ["svg"],
    mime: ["image/svg+xml"],
    loader: () => import("@swarmloom/adapter-svg").then((m) => m.svgAdapter),
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
    loader: () => import("@swarmloom/adapter-office").then((m) => m.slidesAdapter),
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
    loader: () => import("@swarmloom/adapter-office").then((m) => m.sheetAdapter),
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
    loader: () => import("@swarmloom/adapter-code").then((m) => m.codeAdapter),
  },
  {
    id: "image",
    label: "Image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"],
    mime: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"],
    loader: () => import("@swarmloom/adapter-image").then((m) => m.imageAdapter),
  },
  {
    id: "three",
    label: "3D model",
    extensions: ["glb", "gltf", "obj", "stl", "ply"],
    mime: ["model/gltf-binary", "model/gltf+json", "model/obj", "model/stl", "model/x-ply"],
    loader: () => import("@swarmloom/adapter-three").then((m) => m.threeAdapter),
  },
];
