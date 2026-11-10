import type { LanguageFn } from "highlight.js";

/** A language the code and markdown adapters know how to name, detect and highlight. */
export interface LanguageSpec {
  /** Stable id, also used as the highlight.js language name we register. */
  id: string;
  /** Human label shown in title bars and code block headers. */
  label: string;
  /** Two to four letter badge text. */
  short: string;
  /** Lower-case file extensions without the dot. */
  extensions: readonly string[];
  /** Lower-case names accepted after a Markdown code fence (the id is always accepted). */
  aliases: readonly string[];
  /** Exact lower-case file names (Dockerfile, Makefile). */
  fileNames?: readonly string[];
  /** Lower-case MIME types without parameters. */
  mime?: readonly string[];
  /** highlight.js grammar module; absent for plain text. */
  grammar?: GrammarName;
}

type GrammarModule = { default: LanguageFn };

/**
 * Lazy grammar loaders. Each entry is a literal dynamic import so bundlers emit one small chunk
 * per grammar and only fetch the ones a document actually uses.
 */
const GRAMMARS = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  clojure: () => import("highlight.js/lib/languages/clojure"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  dart: () => import("highlight.js/lib/languages/dart"),
  diff: () => import("highlight.js/lib/languages/diff"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  elixir: () => import("highlight.js/lib/languages/elixir"),
  erlang: () => import("highlight.js/lib/languages/erlang"),
  go: () => import("highlight.js/lib/languages/go"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  haskell: () => import("highlight.js/lib/languages/haskell"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  less: () => import("highlight.js/lib/languages/less"),
  lua: () => import("highlight.js/lib/languages/lua"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  objectivec: () => import("highlight.js/lib/languages/objectivec"),
  perl: () => import("highlight.js/lib/languages/perl"),
  php: () => import("highlight.js/lib/languages/php"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  python: () => import("highlight.js/lib/languages/python"),
  r: () => import("highlight.js/lib/languages/r"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  scala: () => import("highlight.js/lib/languages/scala"),
  scss: () => import("highlight.js/lib/languages/scss"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
} satisfies Record<string, () => Promise<GrammarModule>>;

export type GrammarName = keyof typeof GRAMMARS;

/** Loads one highlight.js grammar module on demand. */
export function loadGrammar(name: GrammarName): Promise<GrammarModule> {
  return GRAMMARS[name]();
}

const spec = (s: LanguageSpec): LanguageSpec => s;

/** Every language we can name. Order matters only for documentation. */
export const LANGUAGES: readonly LanguageSpec[] = [
  spec({
    id: "typescript",
    label: "TypeScript",
    short: "TS",
    extensions: ["ts", "mts", "cts", "tsx"],
    aliases: ["ts", "tsx", "mts", "cts"],
    mime: ["application/typescript", "text/typescript"],
    grammar: "typescript",
  }),
  spec({
    id: "javascript",
    label: "JavaScript",
    short: "JS",
    extensions: ["js", "mjs", "cjs", "jsx"],
    aliases: ["js", "jsx", "mjs", "cjs", "node"],
    mime: ["text/javascript", "application/javascript", "application/x-javascript"],
    grammar: "javascript",
  }),
  spec({
    id: "json",
    label: "JSON",
    short: "{}",
    extensions: ["json", "jsonc", "json5", "webmanifest"],
    aliases: ["jsonc", "json5"],
    mime: ["application/json", "application/manifest+json"],
    grammar: "json",
  }),
  spec({ id: "css", label: "CSS", short: "CSS", extensions: ["css"], aliases: [], mime: ["text/css"], grammar: "css" }),
  spec({ id: "scss", label: "SCSS", short: "SCSS", extensions: ["scss"], aliases: ["sass"], grammar: "scss" }),
  spec({ id: "less", label: "Less", short: "LESS", extensions: ["less"], aliases: [], grammar: "less" }),
  spec({
    id: "html",
    label: "HTML",
    short: "HTML",
    extensions: ["html", "htm", "xhtml"],
    aliases: ["xhtml"],
    mime: ["text/html"],
    grammar: "xml",
  }),
  spec({
    id: "xml",
    label: "XML",
    short: "XML",
    extensions: ["xml", "svg", "plist", "xsd", "xsl"],
    aliases: ["svg", "plist"],
    mime: ["application/xml", "text/xml", "image/svg+xml"],
    grammar: "xml",
  }),
  spec({ id: "vue", label: "Vue", short: "VUE", extensions: ["vue"], aliases: [], grammar: "xml" }),
  spec({ id: "svelte", label: "Svelte", short: "SV", extensions: ["svelte"], aliases: [], grammar: "xml" }),
  spec({
    id: "python",
    label: "Python",
    short: "PY",
    extensions: ["py", "pyw", "pyi"],
    aliases: ["py", "py3", "python3"],
    mime: ["text/x-python", "application/x-python"],
    grammar: "python",
  }),
  spec({
    id: "ruby",
    label: "Ruby",
    short: "RB",
    extensions: ["rb", "rake", "gemspec"],
    aliases: ["rb"],
    fileNames: ["gemfile", "rakefile"],
    grammar: "ruby",
  }),
  spec({ id: "go", label: "Go", short: "GO", extensions: ["go"], aliases: ["golang"], grammar: "go" }),
  spec({ id: "rust", label: "Rust", short: "RS", extensions: ["rs"], aliases: ["rs"], grammar: "rust" }),
  spec({
    id: "java",
    label: "Java",
    short: "JAVA",
    extensions: ["java"],
    aliases: [],
    mime: ["text/x-java-source", "text/x-java"],
    grammar: "java",
  }),
  spec({ id: "kotlin", label: "Kotlin", short: "KT", extensions: ["kt", "kts"], aliases: ["kt"], grammar: "kotlin" }),
  spec({ id: "swift", label: "Swift", short: "SWFT", extensions: ["swift"], aliases: [], grammar: "swift" }),
  spec({ id: "c", label: "C", short: "C", extensions: ["c", "h"], aliases: ["h"], mime: ["text/x-c"], grammar: "c" }),
  spec({
    id: "cpp",
    label: "C++",
    short: "C++",
    extensions: ["cc", "cpp", "cxx", "hpp", "hh", "hxx", "ino"],
    aliases: ["c++", "cc", "cxx", "hpp"],
    mime: ["text/x-c++"],
    grammar: "cpp",
  }),
  spec({ id: "csharp", label: "C#", short: "C#", extensions: ["cs"], aliases: ["cs", "c#"], grammar: "csharp" }),
  spec({
    id: "objectivec",
    label: "Objective-C",
    short: "OBJC",
    extensions: ["m", "mm"],
    aliases: ["objc"],
    grammar: "objectivec",
  }),
  spec({ id: "php", label: "PHP", short: "PHP", extensions: ["php"], aliases: [], grammar: "php" }),
  spec({
    id: "bash",
    label: "Shell",
    short: "SH",
    extensions: ["sh", "bash", "zsh", "ksh", "command"],
    aliases: ["sh", "shell", "zsh", "console", "shellscript"],
    fileNames: [".bashrc", ".zshrc", ".profile"],
    mime: ["application/x-sh", "text/x-shellscript"],
    grammar: "bash",
  }),
  spec({
    id: "powershell",
    label: "PowerShell",
    short: "PS",
    extensions: ["ps1", "psm1", "psd1"],
    aliases: ["ps", "ps1", "pwsh"],
    grammar: "powershell",
  }),
  spec({
    id: "sql",
    label: "SQL",
    short: "SQL",
    extensions: ["sql"],
    aliases: ["mysql", "postgres", "postgresql", "sqlite"],
    mime: ["application/sql"],
    grammar: "sql",
  }),
  spec({
    id: "yaml",
    label: "YAML",
    short: "YML",
    extensions: ["yaml", "yml"],
    aliases: ["yml"],
    mime: ["application/yaml", "application/x-yaml", "text/yaml"],
    grammar: "yaml",
  }),
  spec({
    id: "toml",
    label: "TOML",
    short: "TOML",
    extensions: ["toml"],
    aliases: [],
    mime: ["application/toml"],
    grammar: "ini",
  }),
  spec({
    id: "ini",
    label: "INI",
    short: "INI",
    extensions: ["ini", "cfg", "conf", "properties"],
    aliases: ["cfg"],
    grammar: "ini",
  }),
  spec({ id: "lua", label: "Lua", short: "LUA", extensions: ["lua"], aliases: [], grammar: "lua" }),
  spec({ id: "dart", label: "Dart", short: "DART", extensions: ["dart"], aliases: [], grammar: "dart" }),
  spec({ id: "scala", label: "Scala", short: "SC", extensions: ["scala", "sc"], aliases: [], grammar: "scala" }),
  spec({ id: "r", label: "R", short: "R", extensions: ["r"], aliases: [], grammar: "r" }),
  spec({ id: "perl", label: "Perl", short: "PL", extensions: ["pl", "pm"], aliases: ["pl"], grammar: "perl" }),
  spec({ id: "haskell", label: "Haskell", short: "HS", extensions: ["hs"], aliases: ["hs"], grammar: "haskell" }),
  spec({ id: "elixir", label: "Elixir", short: "EX", extensions: ["ex", "exs"], aliases: [], grammar: "elixir" }),
  spec({ id: "erlang", label: "Erlang", short: "ERL", extensions: ["erl"], aliases: ["erl"], grammar: "erlang" }),
  spec({
    id: "clojure",
    label: "Clojure",
    short: "CLJ",
    extensions: ["clj", "cljs", "edn"],
    aliases: ["clj"],
    grammar: "clojure",
  }),
  spec({
    id: "graphql",
    label: "GraphQL",
    short: "GQL",
    extensions: ["graphql", "gql"],
    aliases: ["gql"],
    grammar: "graphql",
  }),
  spec({
    id: "diff",
    label: "Diff",
    short: "DIFF",
    extensions: ["diff", "patch"],
    aliases: ["patch"],
    grammar: "diff",
  }),
  spec({
    id: "dockerfile",
    label: "Dockerfile",
    short: "DOCK",
    extensions: ["dockerfile"],
    aliases: ["docker"],
    fileNames: ["dockerfile", "containerfile"],
    grammar: "dockerfile",
  }),
  spec({
    id: "makefile",
    label: "Makefile",
    short: "MAKE",
    extensions: ["mk", "mak"],
    aliases: ["make", "mk"],
    fileNames: ["makefile", "gnumakefile"],
    grammar: "makefile",
  }),
  spec({
    id: "markdown",
    label: "Markdown",
    short: "MD",
    extensions: ["md", "markdown", "mdown", "mkd"],
    aliases: ["md"],
    grammar: "markdown",
  }),
  spec({
    id: "plaintext",
    label: "Plain text",
    short: "TXT",
    extensions: ["txt", "text", "log"],
    aliases: ["text", "txt", "plain"],
    mime: ["text/plain"],
  }),
];

/** The fallback language: no grammar, no colours. */
export const PLAIN_TEXT: LanguageSpec = LANGUAGES.find((l) => l.id === "plaintext") as LanguageSpec;

const byId = new Map<string, LanguageSpec>();
const byAlias = new Map<string, LanguageSpec>();
const byExtension = new Map<string, LanguageSpec>();
const byFileName = new Map<string, LanguageSpec>();
const byMime = new Map<string, LanguageSpec>();
for (const lang of LANGUAGES) {
  byId.set(lang.id, lang);
  byAlias.set(lang.id, lang);
  for (const a of lang.aliases) byAlias.set(a, lang);
  for (const e of lang.extensions) if (!byExtension.has(e)) byExtension.set(e, lang);
  for (const f of lang.fileNames ?? []) byFileName.set(f, lang);
  for (const m of lang.mime ?? []) byMime.set(m, lang);
}

/** Looks a language up by id. */
export function languageById(id: string): LanguageSpec | undefined {
  return byId.get(id);
}

/**
 * Resolves the info string of a Markdown code fence ("ts", "TypeScript", "js {1,3}") to a language.
 * Unknown names resolve to undefined so callers can still show the name as written.
 */
export function languageForFence(info: string | null | undefined): LanguageSpec | undefined {
  if (!info) return undefined;
  const name = info.trim().split(/[\s{]/, 1)[0]?.toLowerCase() ?? "";
  if (!name) return undefined;
  return byAlias.get(name) ?? byExtension.get(name);
}

/** Looks a language up by file extension (without dot, any case). */
export function languageForExtension(ext: string): LanguageSpec | undefined {
  return byExtension.get(ext.toLowerCase());
}

/** Looks a language up by exact file name such as "Dockerfile". */
export function languageForFileName(fileName: string): LanguageSpec | undefined {
  return byFileName.get(fileName.toLowerCase());
}

/** Looks a language up by MIME type; parameters such as "; charset=utf-8" are ignored. */
export function languageForMime(mime: string): LanguageSpec | undefined {
  return byMime.get(mime.split(";", 1)[0]?.trim().toLowerCase() ?? "");
}
