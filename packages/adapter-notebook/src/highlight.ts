/**
 * Syntax highlighting with highlight.js (a private instance with the usual notebook kernel
 * languages). Token classes become inline colours, so the stage needs no extra style sheet and the
 * text choreography types coloured code as it is.
 */

import { escapeHtml } from "@swarmloom/adapter-terminal/ansi";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import julia from "highlight.js/lib/languages/julia";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import { type NotebookPalette, type SyntaxGroup, syntaxCss } from "./theme";

const LANGUAGES = { bash, cpp, javascript, json, julia, python, r, scala, sql, typescript };

const ALIASES: Record<string, keyof typeof LANGUAGES> = {
  py: "python",
  python2: "python",
  python3: "python",
  ipython: "python",
  ipython3: "python",
  sage: "python",
  js: "javascript",
  node: "javascript",
  deno: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  "c++": "cpp",
  c: "cpp",
  "c++17": "cpp",
  rlang: "r",
  jl: "julia",
  sparql: "sql",
  postgresql: "sql",
};

/** Longest source highlighted; longer code is shown plain. */
const MAX_HIGHLIGHT = 200_000;

let instance: ReturnType<typeof hljs.newInstance> | null = null;

function engine(): ReturnType<typeof hljs.newInstance> {
  if (!instance) {
    instance = hljs.newInstance();
    for (const [name, fn] of Object.entries(LANGUAGES)) instance.registerLanguage(name, fn);
  }
  return instance;
}

/** The registered language for a kernel or fence name, or null. */
export function resolveLanguage(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase().split(/[\s{]/)[0] ?? "";
  if (key in LANGUAGES) return key;
  return ALIASES[key] ?? null;
}

const GROUPS: Record<string, SyntaxGroup> = {
  keyword: "keyword",
  "variable.language_": "keyword",
  name: "keyword",
  tag: "keyword",
  built_in: "builtin",
  type: "type",
  "title.class_": "type",
  "title.class_.inherited__": "type",
  literal: "number",
  number: "number",
  symbol: "number",
  bullet: "number",
  string: "string",
  regexp: "string",
  char: "string",
  "char.escape_": "string",
  comment: "comment",
  doctag: "comment",
  quote: "comment",
  meta: "meta",
  "meta.keyword": "meta",
  "meta.string": "string",
  title: "title",
  "title.function_": "title",
  "title.function_.invoke__": "title",
  section: "title",
  attr: "attr",
  attribute: "attr",
  property: "attr",
  params: "attr",
  addition: "added",
  deletion: "removed",
};

/** Scope name of a highlight.js class list: "hljs-title function_" -> "title.function_". */
function scopeOf(classes: string): string {
  const parts = classes.split(/\s+/).filter(Boolean);
  const head = (parts[0] ?? "").replace(/^hljs-/, "");
  return [head, ...parts.slice(1)].join(".");
}

function groupOf(scope: string): SyntaxGroup | undefined {
  if (scope === "params") return undefined;
  let s = scope;
  while (s) {
    const g = GROUPS[s];
    if (g) return g;
    const dot = s.lastIndexOf(".");
    s = dot > 0 ? s.slice(0, dot) : "";
  }
  return undefined;
}

/**
 * Highlights `code` as `language` (kernel or fence name). Returns escaped HTML whose tokens are
 * `<span style>` runs; unknown languages and very long code come back escaped but uncoloured.
 */
export function highlightCode(code: string, language: string | null | undefined, palette: NotebookPalette): string {
  const lang = resolveLanguage(language);
  if (!lang || code.length > MAX_HIGHLIGHT) return escapeHtml(code);
  let html: string;
  try {
    html = engine().highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
  // highlight.js emits only escaped text and <span class="..."> elements.
  return html.replace(/<span class="([^"]*)">/g, (_m, classes: string) => {
    const group = groupOf(scopeOf(classes));
    if (scopeOf(classes) === "emphasis") return '<span style="font-style:italic">';
    if (scopeOf(classes) === "strong") return '<span style="font-weight:700">';
    return group ? `<span style="${syntaxCss(palette, group)}">` : "<span>";
  });
}
