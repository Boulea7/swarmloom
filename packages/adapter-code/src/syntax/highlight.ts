import type { HLJSApi } from "highlight.js";
import { escapeHtml } from "../util/escape";
import { type GrammarName, type LanguageSpec, languageById, loadGrammar, PLAIN_TEXT } from "./languages";
import { type CodeTheme, resolveTokenStyle, tokenCss } from "./themes";

/** A run of characters sharing one highlight scope. `scope` is "" for unstyled text. */
export interface Token {
  text: string;
  /** Space separated scope chain, outermost first, e.g. "meta meta.string". */
  scope: string;
}

/** One source line split into tokens. Never contains a line break. */
export type TokenLine = Token[];

export interface Highlighted {
  language: LanguageSpec;
  lines: TokenLine[];
  /** Set when highlighting was skipped or failed; the lines are then plain text. */
  warning?: string;
}

export interface HighlightOptions {
  /** Inputs longer than this are not highlighted (plain text). Default 400 000 characters. */
  maxChars?: number;
}

/** Grammars a language embeds (HTML embeds CSS and JavaScript). Loaded together with it. */
const EMBEDDED: Partial<Record<GrammarName, GrammarName[]>> = {
  xml: ["css", "javascript"],
  markdown: ["xml"],
  php: ["xml", "css", "javascript"],
};

const DEFAULT_MAX_CHARS = 400_000;

let engine: Promise<HLJSApi> | undefined;
const registered = new Map<GrammarName, Promise<boolean>>();

/** One private highlight.js instance, so we never touch a global one the host page may use. */
function getEngine(): Promise<HLJSApi> {
  engine ??= import("highlight.js/lib/core").then((m) => {
    const hljs = m.default.newInstance();
    hljs.configure({ classPrefix: "hljs-" });
    return hljs;
  });
  return engine;
}

/** Registers a grammar (and those it embeds) once. Resolves false when a chunk failed to load. */
function ensureGrammar(hljs: HLJSApi, name: GrammarName): Promise<boolean> {
  let pending = registered.get(name);
  if (!pending) {
    pending = (async () => {
      const embedded = EMBEDDED[name] ?? [];
      await Promise.all(embedded.map((n) => ensureGrammar(hljs, n)));
      const mod = await loadGrammar(name);
      hljs.registerLanguage(name, mod.default);
      return true;
    })().catch(() => {
      registered.delete(name);
      return false;
    });
    registered.set(name, pending);
  }
  return pending;
}

/** Splits text into plain token lines (no highlighting). */
export function plainLines(code: string): TokenLine[] {
  return splitLines(code).map((text) => (text ? [{ text, scope: "" }] : []));
}

/** Splits on \n, \r\n and lone \r. A trailing newline does not create an extra empty line. */
export function splitLines(code: string): string[] {
  const lines = code.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Highlights source code with highlight.js, loading only the grammars the language needs.
 * Never throws for bad input: unknown languages, oversize input and grammar load failures fall
 * back to plain text and set `warning`.
 */
export async function highlight(
  code: string,
  language: LanguageSpec | string | undefined,
  opts: HighlightOptions = {},
): Promise<Highlighted> {
  const lang = typeof language === "string" ? (languageById(language) ?? PLAIN_TEXT) : (language ?? PLAIN_TEXT);
  const grammar = lang.grammar;
  if (!grammar) return { language: lang, lines: plainLines(code) };

  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  if (code.length > maxChars) {
    return { language: lang, lines: plainLines(code), warning: `not highlighted: longer than ${maxChars} characters` };
  }

  const hljs = await getEngine();
  if (!(await ensureGrammar(hljs, grammar))) {
    return { language: lang, lines: plainLines(code), warning: `could not load the ${lang.label} grammar` };
  }
  try {
    const html = hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value;
    return { language: lang, lines: parseHighlightHtml(html) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { language: lang, lines: plainLines(code), warning: `highlighting failed: ${reason}` };
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const cp =
        body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Converts a highlight.js class attribute to a scope key: "hljs-title function_" -> "title.function",
 * "hljs-title class_ inherited__" -> "title.class.inherited". Sub-language wrappers give "".
 */
export function classToScope(className: string): string {
  const parts = className.trim().split(/\s+/);
  const head = parts[0] ?? "";
  if (!head.startsWith("hljs-")) return "";
  const keys = [head.slice(5)];
  for (const p of parts.slice(1)) keys.push(p.replace(/_+$/, ""));
  return keys.filter(Boolean).join(".");
}

/**
 * Parses highlight.js output (escaped text and nested `<span class>` only) into token lines,
 * splitting multi-line spans at line breaks.
 */
export function parseHighlightHtml(html: string): TokenLine[] {
  const lines: TokenLine[] = [[]];
  const stack: string[] = [];
  const re = /<span class="([^"]*)">|<\/span>|[^<]+/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const piece = m[0];
    if (m[1] !== undefined) {
      stack.push(classToScope(m[1]));
      continue;
    }
    if (piece === "</span>") {
      stack.pop();
      continue;
    }
    const scope = stack.filter(Boolean).join(" ");
    const parts = decodeEntities(piece).split(/\r\n|\r|\n/);
    parts.forEach((text, i) => {
      if (i > 0) lines.push([]);
      if (!text) return;
      const line = lines[lines.length - 1] as TokenLine;
      const last = line[line.length - 1];
      if (last && last.scope === scope) last.text += text;
      else line.push({ text, scope });
    });
  }
  if (lines.length > 1 && (lines[lines.length - 1] as TokenLine).length === 0) lines.pop();
  return lines;
}

/** Plain text of a token line. */
export function lineText(line: TokenLine): string {
  let s = "";
  for (const t of line) s += t.text;
  return s;
}

/**
 * Renders a token line as HTML with inline colour styles from `theme`.
 * Adjacent tokens with the same resolved style share one span.
 */
export function lineToHtml(line: TokenLine, theme: CodeTheme): string {
  let html = "";
  let openCss = "";
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    html += openCss ? `<span style="${openCss}">${escapeHtml(buffer)}</span>` : escapeHtml(buffer);
    buffer = "";
  };
  for (const token of line) {
    const css = tokenCss(resolveTokenStyle(theme, token.scope));
    // Whitespace looks the same in any colour: keep it in the current run.
    if (css !== openCss && token.text.trim() !== "") {
      flush();
      openCss = css;
    }
    buffer += token.text;
  }
  flush();
  return html;
}

/** Expands tabs to spaces at the given tab stop so column counts and layout agree. */
export function expandTabs(text: string, tabSize = 4): string {
  if (!text.includes("\t")) return text;
  let out = "";
  for (const ch of text) {
    if (ch === "\t") out += " ".repeat(tabSize - (out.length % tabSize));
    else out += ch;
  }
  return out;
}
