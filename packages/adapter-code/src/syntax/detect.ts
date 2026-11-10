import {
  type LanguageSpec,
  languageById,
  languageForExtension,
  languageForFileName,
  languageForMime,
  PLAIN_TEXT,
} from "./languages";

/** What is known about a source when picking its language. */
export interface DetectInput {
  /** File name or URL path; only the last segment is used. */
  name?: string;
  mime?: string;
  /** Source text; only the first few KB are inspected. */
  text?: string;
}

/** How many characters of the text the content heuristics look at. */
const SNIFF_CHARS = 8192;

/** Generic MIME types that say nothing about the language. */
const GENERIC_MIME = new Set(["text/plain", "application/octet-stream", ""]);

/**
 * Picks the language of a source file. Deterministic: file name first (exact names such as
 * Dockerfile, then the extension), then a specific MIME type, then a shebang and small content
 * heuristics. Never runs highlight.js auto-detection, so exports do not depend on which grammars
 * happen to be loaded.
 */
export function detectLanguage(input: DetectInput): LanguageSpec {
  const fromName = input.name ? languageForName(input.name) : undefined;
  if (fromName && fromName !== PLAIN_TEXT) return fromName;

  const mime = input.mime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!GENERIC_MIME.has(mime)) {
    const fromMime = languageForMime(mime);
    if (fromMime) return fromMime;
  }

  const fromText = input.text ? sniffLanguage(input.text) : undefined;
  return fromText ?? fromName ?? PLAIN_TEXT;
}

/** Language from a file name or URL (query and hash are ignored). */
export function languageForName(name: string): LanguageSpec | undefined {
  const base = baseName(name);
  if (!base) return undefined;
  const exact = languageForFileName(base);
  if (exact) return exact;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return undefined;
  // "Dockerfile.dev" style names fall back to their prefix.
  return languageForExtension(base.slice(dot + 1)) ?? languageForFileName(base.slice(0, dot));
}

function baseName(name: string): string {
  const path = name.split(/[?#]/, 1)[0] ?? "";
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(slash + 1).trim();
}

const SHEBANGS: [RegExp, string][] = [
  [/\b(?:node|deno|bun|nodejs)\b/, "javascript"],
  [/\b(?:ts-node|tsx)\b/, "typescript"],
  [/\bpython[0-9.]*\b/, "python"],
  [/\bruby\b/, "ruby"],
  [/\bperl\b/, "perl"],
  [/\bpwsh\b/, "powershell"],
  [/\b(?:ba|z|k|da)?sh\b/, "bash"],
];

/**
 * Content rules: each pattern that matches adds its weight to the language. The best total wins
 * when it reaches {@link MIN_SCORE}. Weights are tuned so one strong marker beats several weak ones.
 */
const RULES: [string, RegExp, number][] = [
  ["typescript", /^\s*(?:export\s+)?(?:interface|type)\s+[A-Z]\w*(?:<[^>]*>)?\s*(?:=|\{|extends)/m, 6],
  ["typescript", /^\s*import\s+type\s/m, 6],
  ["typescript", /[(,]\s*\w+\??:\s*(?:string|number|boolean|unknown|void|readonly)\b/, 4],
  ["typescript", /\)\s*:\s*(?:Promise<|string|number|boolean|void)\b/, 4],
  ["typescript", /\bas\s+const\b|\benum\s+[A-Z]\w*\s*\{/, 4],
  ["javascript", /^\s*(?:const|let|var)\s+[\w${}[\],\s]+=/m, 2],
  ["javascript", /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*\w*\s*\(/m, 2],
  ["javascript", /^\s*import\s+[\w*{][^;\n]*\sfrom\s+["']/m, 3],
  ["javascript", /\brequire\(["'][^"']+["']\)|\bmodule\.exports\b/, 3],
  ["javascript", /=>\s*[{(]?/, 1],
  ["python", /^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:]+)?:\s*$/m, 5],
  ["python", /^\s*from\s+[\w.]+\s+import\s+/m, 4],
  ["python", /^\s*class\s+\w+(?:\([^)]*\))?:\s*$/m, 4],
  ["python", /^\s*if\s+__name__\s*==\s*["']__main__["']/m, 6],
  ["python", /^\s*(?:elif|except|with)\b.*:\s*$/m, 3],
  ["go", /^package\s+\w+\s*$/m, 4],
  ["go", /^func\s+(?:\([^)]*\)\s*)?\w+\s*\(/m, 4],
  ["go", /:=/, 1],
  ["rust", /^\s*(?:pub\s+)?fn\s+\w+\s*(?:<[^>]*>)?\s*\(/m, 5],
  ["rust", /\blet\s+mut\b|\bimpl(?:<[^>]*>)?\s+\w+|^\s*use\s+\w+::/m, 4],
  ["cpp", /#include\s*<(?:iostream|vector|string|memory|map)>|\bstd::|\btemplate\s*</, 6],
  ["c", /#include\s*[<"][\w./]+\.h[>"]/, 5],
  ["c", /^\s*int\s+main\s*\(/m, 2],
  ["java", /^\s*public\s+(?:final\s+)?class\s+\w+/m, 5],
  ["java", /\bpublic\s+static\s+void\s+main\s*\(/, 6],
  ["kotlin", /^\s*fun\s+\w+\s*\(|^\s*val\s+\w+\s*[:=]/m, 4],
  ["csharp", /^\s*using\s+System\b|^\s*namespace\s+[\w.]+\s*[{;]/m, 5],
  ["php", /<\?php\b/, 10],
  ["ruby", /^\s*(?:require|require_relative)\s+["']|^\s*def\s+\w+[?!]?\s*$|^\s*end\s*$/m, 3],
  ["bash", /^\s*(?:echo|export|cd|sudo|apt-get|brew|npm|pnpm|git)\s+\S/m, 2],
  ["bash", /^\s*(?:if|while)\s+\[\[?\s|^\s*fi\s*$|^\s*done\s*$/m, 4],
  ["sql", /^\s*(?:SELECT\s+[\w*]|INSERT\s+INTO|CREATE\s+(?:TABLE|INDEX|VIEW)|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/im, 6],
  ["css", /^\s*[.#]?[\w-]+(?:[\s>+~:.#[\]="'\w-]*)\{\s*$/m, 2],
  ["css", /^\s*[\w-]+\s*:\s*[^;{}]+;\s*$/m, 2],
  ["css", /^\s*@(?:media|keyframes|font-face|import)\b/m, 4],
  ["yaml", /^---\s*$/m, 1],
  ["yaml", /^[\w-]+:\s+\S[^{};]*$/m, 2],
  ["yaml", /^\s+-\s+[\w"']/m, 1],
  ["dockerfile", /^FROM\s+\S+/m, 4],
  ["dockerfile", /^(?:RUN|COPY|WORKDIR|ENTRYPOINT|CMD)\s+\S/m, 3],
  ["diff", /^(?:---|\+\+\+)\s+\S/m, 3],
  ["diff", /^@@\s+-\d+(?:,\d+)?\s+\+\d+/m, 6],
];

const MIN_SCORE = 4;

/**
 * Guesses the language of text without a usable name. Returns undefined when nothing is
 * convincing; callers fall back to plain text.
 */
export function sniffLanguage(text: string): LanguageSpec | undefined {
  const head = text.slice(0, SNIFF_CHARS).replace(/^﻿/, "");
  const trimmed = head.trimStart();

  if (trimmed.startsWith("#!")) {
    const nl = trimmed.indexOf("\n");
    const line = nl === -1 ? trimmed : trimmed.slice(0, nl);
    for (const [re, id] of SHEBANGS) if (re.test(line)) return languageById(id);
  }
  if (/^<\?php\b/.test(trimmed)) return languageById("php");
  if (/^<\?xml\b/.test(trimmed) || /^<svg[\s>]/i.test(trimmed)) return languageById("xml");
  if (/^(?:<!doctype\s+html|<html[\s>])/i.test(trimmed)) return languageById("html");
  if (looksLikeJson(trimmed, text)) return languageById("json");

  const scores = new Map<string, number>();
  for (const [id, re, weight] of RULES) {
    if (re.test(head)) scores.set(id, (scores.get(id) ?? 0) + weight);
  }
  // TypeScript is a superset of JavaScript: JS markers count for it too.
  const ts = scores.get("typescript");
  if (ts !== undefined) scores.set("typescript", ts + (scores.get("javascript") ?? 0));

  let best: string | undefined;
  let bestScore = 0;
  for (const [id, score] of scores) {
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best && bestScore >= MIN_SCORE ? languageById(best) : undefined;
}

function looksLikeJson(trimmed: string, full: string): boolean {
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return false;
  // Parsing is only attempted for reasonably small inputs; large ones use the cheap check.
  if (full.length > 512 * 1024) return /^[{[]\s*(?:"|\{|\[|\]|\}|-?\d)/.test(trimmed);
  try {
    JSON.parse(full.replace(/^﻿/, ""));
    return true;
  } catch {
    return false;
  }
}
