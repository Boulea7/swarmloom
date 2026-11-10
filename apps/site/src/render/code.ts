/**
 * A deliberately tiny highlighter for the three snippets on the page (shell and HTML).
 * Output is escaped markup with <span class="tk-*"> tokens.
 */

import { esc } from "./html";

function span(cls: string, text: string): string {
  return text ? `<span class="tk-${cls}">${esc(text)}</span>` : "";
}

function shellLine(line: string): string {
  if (line.trim().startsWith("#")) return span("comment", line);
  return line
    .split(/(\s+|&&)/)
    .map((part, index, parts) => {
      if (part === "" || /^\s+$/.test(part)) return esc(part);
      if (part === "&&") return span("punct", part);
      const previous = parts
        .slice(0, index)
        .filter((p) => p.trim() !== "")
        .pop();
      if (previous === undefined || previous === "&&") return span("cmd", part);
      if (part.startsWith("-")) return span("flag", part);
      if (/^https?:\/\//.test(part)) return span("str", part);
      return esc(part);
    })
    .join("");
}

const HTML_TOKEN = /(<\/?)([a-zA-Z][\w-]*)|(\s)([a-zA-Z-]+)(=)?|("[^"]*")|(\/?>)|([^<"\s>=]+|[\s=]+)/g;

function htmlLine(line: string, state: { inScript: boolean }): string {
  let out = "";
  let inTag = false;
  for (const match of line.matchAll(HTML_TOKEN)) {
    const [whole, open, tag, space, attr, eq, str, close] = match;
    if (open && tag) {
      inTag = true;
      out += span("punct", open) + span("tag", tag);
      if (tag === "script") state.inScript = open === "<";
    } else if (inTag && attr !== undefined && space !== undefined) {
      out += esc(space) + span("attr", attr) + (eq ? span("punct", eq) : "");
    } else if (str) {
      out += span("str", str);
    } else if (close) {
      inTag = false;
      out += span("punct", close);
    } else if (state.inScript && !inTag) {
      const word = whole.trimStart();
      const lead = whole.slice(0, whole.length - word.length);
      out += esc(lead) + (/^(import|from|const|export)$/.test(word) ? span("kw", word) : esc(word));
    } else {
      out += esc(whole);
    }
  }
  return out;
}

/** Highlights a snippet. Unknown languages are escaped only. */
export function highlight(code: string, lang: string): string {
  const lines = code.split("\n");
  if (lang === "shell") return lines.map(shellLine).join("\n");
  if (lang === "html") {
    const state = { inScript: false };
    return lines.map((line) => htmlLine(line, state)).join("\n");
  }
  return esc(code);
}
