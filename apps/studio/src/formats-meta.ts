/**
 * Static format metadata Studio needs before any adapter loads: the PWA manifest (file handlers,
 * share target), the example scanner and the file picker. It mirrors the ids and extensions of the
 * `@swarmloom/formats` registry, including its order (the first entry that lists an extension
 * wins, so `.ods` stays with the spreadsheet reader); test/formats-meta.test.ts fails when the
 * two drift apart.
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
  /**
   * The adapter ships separately and may be missing from the registry Studio is built with. Such
   * formats stay hidden (picker, gallery, format list) until the registry has them, and are never
   * registered as OS file handlers.
   */
  readonly optional?: boolean;
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
    // Legacy .ppt/.xls are not listed, as in the registry: only their CFB streams reach these
    // adapters, which ask for .pptx/.xlsx. Studio never offers them in the picker or as handlers.
    extensions: ["pptx"],
    handlers: {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
    },
    textual: false,
    light: false,
  },
  {
    id: "sheet",
    label: "Spreadsheet",
    extensions: ["xlsx", "xlsm", "ods", "csv", "tsv"],
    handlers: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel.sheet.macroenabled.12": [".xlsm"],
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
    extensions: ["png", "apng", "jpg", "jpeg", "jfif", "gif", "webp", "avif", "bmp"],
    handlers: {
      "image/png": [".png"],
      "image/apng": [".apng"],
      "image/jpeg": [".jpg", ".jpeg", ".jfif"],
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
  {
    // After "sheet", as in the registry: .ods (and .fods) open with the spreadsheet reader.
    id: "odf",
    label: "OpenDocument",
    extensions: ["odt", "ott", "fodt", "ods", "ots", "fods", "odp", "otp", "fodp", "odg", "fodg"],
    handlers: {
      "application/vnd.oasis.opendocument.text": [".odt", ".fodt"],
      "application/vnd.oasis.opendocument.text-template": [".ott"],
      "application/vnd.oasis.opendocument.spreadsheet-template": [".ots"],
      "application/vnd.oasis.opendocument.presentation": [".odp", ".fodp"],
      "application/vnd.oasis.opendocument.presentation-template": [".otp"],
      "application/vnd.oasis.opendocument.graphics": [".odg", ".fodg"],
    },
    textual: false,
    light: false,
  },
  {
    id: "epub",
    label: "EPUB e-book",
    extensions: ["epub"],
    handlers: { "application/epub+zip": [".epub"] },
    textual: false,
    light: false,
  },
  {
    id: "rtf",
    label: "Rich Text (RTF)",
    extensions: ["rtf"],
    handlers: { "application/rtf": [".rtf"] },
    textual: true,
    light: false,
  },
  {
    id: "ofd",
    label: "OFD document",
    extensions: ["ofd"],
    handlers: { "application/ofd": [".ofd"] },
    textual: false,
    light: false,
  },
  {
    id: "notebook",
    label: "Jupyter notebook",
    extensions: ["ipynb"],
    handlers: { "application/x-ipynb+json": [".ipynb"] },
    textual: true,
    light: false,
  },
  {
    id: "terminal",
    label: "Terminal recording",
    extensions: ["cast"],
    handlers: { "application/x-asciicast": [".cast"] },
    textual: true,
    light: true,
    maxBytes: 32 * MIB,
  },
  {
    id: "diff",
    label: "Patch",
    extensions: ["diff", "patch"],
    handlers: { "text/x-diff": [".diff", ".patch"] },
    textual: true,
    light: true,
    maxBytes: 16 * MIB,
  },
  {
    // .mm is XML text but .xmind is a ZIP package; both travel as bytes.
    id: "mindmap",
    label: "Mind map",
    extensions: ["xmind", "mm"],
    handlers: { "application/vnd.xmind.workbook": [".xmind"], "application/x-freemind": [".mm"] },
    textual: false,
    light: true,
    maxBytes: 32 * MIB,
  },
  {
    // dotLottie archives. Lottie JSON keeps the .json extension and is detected by content. The
    // bundled registry provides the adapter; registries without it (custom CDN builds) hide it.
    id: "lottie",
    label: "Lottie animation",
    extensions: ["lottie"],
    handlers: {},
    textual: false,
    light: false,
    optional: true,
  },
];

const BY_EXTENSION: ReadonlyMap<string, FormatMeta> = (() => {
  // The first entry that lists an extension wins, like the registry's own lookup.
  const map = new Map<string, FormatMeta>();
  for (const meta of FORMAT_META) for (const ext of meta.extensions) if (!map.has(ext)) map.set(ext, meta);
  return map;
})();

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

/**
 * The formats this build can open: every entry, minus optional ones the registry does not provide.
 *
 * @param registryIds Adapter ids of the `@swarmloom/formats` registry; without it, optional formats are hidden.
 */
export function availableFormats(registryIds?: Iterable<string>): readonly FormatMeta[] {
  const present = new Set(registryIds ?? []);
  return FORMAT_META.filter((meta) => !meta.optional || present.has(meta.id));
}

/** `accept` attribute value for a file input covering every extension of `formats`. */
export function acceptAttribute(formats: readonly FormatMeta[] = FORMAT_META): string {
  return [...new Set(formats.flatMap((meta) => meta.extensions.map((ext) => `.${ext}`)))].join(",");
}
