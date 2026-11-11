/**
 * Static format metadata Studio needs before any adapter loads: the PWA manifest (file handlers,
 * share target), the example scanner and the file picker. It mirrors the extension and MIME lists of
 * the `@swarmloom/formats` registry; test/formats-meta.test.ts fails when the two drift apart.
 *
 * This module has no imports so the Node-side build plugins can use it as well.
 */

export interface FormatMeta {
  /** Adapter id, equal to the registry entry id. */
  readonly id: string;
  /** English short name; core's `format.<id>` translation wins when available. */
  readonly label: string;
  /** Lower-case extensions without the dot. */
  readonly extensions: readonly string[];
  /** MIME types the PWA registers as file handlers (one per group of extensions). */
  readonly handlers: Readonly<Record<string, readonly string[]>>;
  /** Plain-text formats can be pasted and shared through a URL hash. */
  readonly textual: boolean;
  /** Cheap to parse and play on small devices (watch mode cycles only these). */
  readonly light: boolean;
  /**
   * The adapter's default input limit (bytes, or UTF-16 code units for text), set only when it is
   * below Studio's own limit so Studio can explain the rejection before the adapter throws.
   */
  readonly maxBytes?: number;
}

const MIB = 1024 * 1024;

export const FORMAT_META: readonly FormatMeta[] = [
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    handlers: { "text/markdown": [".md", ".markdown", ".mdown", ".mkd"] },
    textual: true,
    light: true,
    maxBytes: 4 * MIB,
  },
  {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm", "xhtml"],
    handlers: { "text/html": [".html", ".htm"], "application/xhtml+xml": [".xhtml"] },
    textual: true,
    light: true,
    maxBytes: 8 * MIB,
  },
  {
    id: "docx",
    label: "Word document",
    extensions: ["docx"],
    handlers: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
    textual: false,
    light: false,
  },
  {
    id: "doc",
    label: "Word 97-2003 document",
    extensions: ["doc"],
    handlers: { "application/msword": [".doc"] },
    textual: false,
    light: false,
  },
  {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    handlers: { "application/pdf": [".pdf"] },
    textual: false,
    light: false,
  },
  {
    id: "svg",
    label: "SVG",
    extensions: ["svg"],
    handlers: { "image/svg+xml": [".svg"] },
    textual: true,
    light: true,
    maxBytes: 16 * MIB,
  },
  {
    id: "slides",
    label: "Presentation",
    extensions: ["pptx", "ppt", "odp"],
    handlers: {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "application/vnd.ms-powerpoint": [".ppt"],
      "application/vnd.oasis.opendocument.presentation": [".odp"],
    },
    textual: false,
    light: false,
  },
  {
    id: "sheet",
    label: "Spreadsheet",
    extensions: ["xlsx", "xlsm", "xls", "ods", "csv", "tsv"],
    handlers: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel.sheet.macroenabled.12": [".xlsm"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
      "text/csv": [".csv"],
      "text/tab-separated-values": [".tsv"],
    },
    textual: true,
    light: false,
  },
  {
    id: "code",
    label: "Code",
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
    handlers: {
      "text/plain": [".txt", ".ts", ".mts", ".cts", ".tsx", ".jsx", ".go", ".rs", ".kt", ".swift", ".cs", ".php"],
      "text/javascript": [".js", ".mjs", ".cjs"],
      "application/json": [".json"],
      "text/css": [".css", ".scss", ".less"],
      "text/x-python": [".py"],
      "text/x-ruby": [".rb"],
      "text/x-java-source": [".java", ".scala", ".dart", ".lua"],
      "text/x-c": [".c", ".h", ".cc", ".cpp", ".hpp"],
      "application/x-sh": [".sh", ".bash", ".zsh"],
      "application/sql": [".sql"],
      "application/yaml": [".yaml", ".yml"],
      "application/toml": [".toml"],
      "application/xml": [".xml"],
      "text/x-vue": [".vue", ".svelte"],
    },
    textual: true,
    light: true,
    maxBytes: 2 * MIB,
  },
  {
    id: "image",
    label: "Image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"],
    handlers: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/gif": [".gif"],
      "image/webp": [".webp"],
      "image/avif": [".avif"],
      "image/bmp": [".bmp"],
    },
    textual: false,
    light: true,
  },
  {
    id: "three",
    label: "3D model",
    extensions: ["glb", "gltf", "obj", "stl", "ply"],
    handlers: {
      "model/gltf-binary": [".glb"],
      "model/gltf+json": [".gltf"],
      "model/obj": [".obj"],
      "model/stl": [".stl"],
      "model/x-ply": [".ply"],
    },
    textual: false,
    light: false,
  },
];

const BY_EXTENSION: ReadonlyMap<string, FormatMeta> = new Map(
  FORMAT_META.flatMap((meta) => meta.extensions.map((ext) => [ext, meta] as const)),
);

const BY_ID: ReadonlyMap<string, FormatMeta> = new Map(FORMAT_META.map((meta) => [meta.id, meta]));

/** Lower-case extension of a file name without the dot, or "" when there is none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Format metadata for a file name, by extension. */
export function formatOfName(name: string): FormatMeta | undefined {
  return BY_EXTENSION.get(extensionOf(name));
}

/** Format metadata by adapter id. */
export function formatById(id: string): FormatMeta | undefined {
  return BY_ID.get(id);
}

/** `accept` attribute value for a file input covering every supported extension. */
export function acceptAttribute(): string {
  return FORMAT_META.flatMap((meta) => meta.extensions.map((ext) => `.${ext}`)).join(",");
}
