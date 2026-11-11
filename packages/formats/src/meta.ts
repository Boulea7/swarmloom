import type { Adapter } from "@swarmloom/core";
import { isLottieJsonBytes } from "./text";

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
    // Legacy .ppt is not listed: the adapter rejects it, and its CFB stream still routes it there for the message.
    extensions: ["pptx"],
    mime: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  {
    id: "sheet",
    label: "Spreadsheet",
    // Legacy .xls is not listed (the adapter rejects it). Its MIME type stays: Windows browsers give it to .csv files.
    extensions: ["xlsx", "xlsm", "ods", "csv", "tsv"],
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
  {
    // After "sheet": .ods and the ODS MIME type stay with the spreadsheet adapter.
    id: "odf",
    label: "OpenDocument",
    extensions: ["odt", "ott", "fodt", "ods", "ots", "fods", "odp", "otp", "fodp", "odg", "fodg"],
    mime: [
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.text-template",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.spreadsheet-template",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.oasis.opendocument.presentation-template",
      "application/vnd.oasis.opendocument.graphics",
    ],
  },
  { id: "epub", label: "EPUB e-book", extensions: ["epub"], mime: ["application/epub+zip"] },
  { id: "rtf", label: "Rich Text (RTF)", extensions: ["rtf"], mime: ["application/rtf", "text/rtf"] },
  { id: "ofd", label: "OFD document", extensions: ["ofd"], mime: ["application/ofd"] },
  { id: "notebook", label: "Jupyter notebook", extensions: ["ipynb"], mime: ["application/x-ipynb+json"] },
  { id: "terminal", label: "Terminal recording", extensions: ["cast"], mime: ["application/x-asciicast"] },
  {
    id: "diff",
    label: "Patch",
    extensions: ["diff", "patch"],
    mime: ["text/x-diff", "text/x-patch", "application/x-patch"],
  },
  {
    id: "mindmap",
    label: "Mind map",
    extensions: ["xmind", "mm"],
    mime: ["application/vnd.xmind.workbook", "application/x-freemind", "application/x-xmind"],
  },
  {
    // dotLottie archives go by their ZIP entries (detect.ts); Lottie JSON keeps the .json name and
    // is recognised by content, before the name sends it to the code adapter.
    id: "lottie",
    label: "Lottie animation",
    extensions: ["lottie"],
    mime: ["application/json+lottie", "application/zip+dotlottie"],
    sniff: isLottieJsonBytes,
  },
];
