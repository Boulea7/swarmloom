/** Content heuristics for text inputs that carry no reliable name or MIME type (pasted text, extensionless URLs). */

/** Adapter ids the text heuristics can return. */
export type TextFormat = "svg" | "html" | "markdown" | "code" | "sheet" | "three";

/** Only the head is inspected; classification must stay cheap for 50 MB inputs. */
const SAMPLE_CHARS = 16384;
const SAMPLE_LINES = 200;

const SVG_RE = /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype svg[^>]*>\s*)?<svg[\s>]/i;
const HTML_DOC_RE = /^(?:<!--[\s\S]*?-->\s*)*(?:<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i;
const HTML_TAG_RE =
  /<\/(?:div|p|span|section|article|main|header|footer|nav|ul|ol|li|table|h[1-6]|a|button|form|style)>/i;
const GLTF_RE = /^\{[\s\S]{0,4000}"asset"\s*:\s*\{[^}]{0,400}"version"\s*:\s*"[12]\./;
const JSON_RE = /^[[{]\s*(?:["{[\]}\d-]|true|false|null)/;
const STL_RE = /^solid\b[^\n]*\n\s*facet\s+normal\b/;
const OBJ_LINE_RE = /^(?:v|vt|vn|vp|f|l|o|g|s|usemtl|mtllib)\s/;

const MD_RULES: [RegExp, number][] = [
  [/^#{1,6}\s+\S/, 2], // ATX heading
  [/^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+\S/, 1], // list item
  [/^>\s?\S/, 1], // block quote
  [/^(?:```|~~~)/, 1], // fence
  [/!?\[[^\]\n]+\]\([^)\s]+[^)]*\)/, 2], // link or image
  [/(\*\*|__)\S[^\n]*?\S\1/, 1], // strong emphasis
  [/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/, 3], // table delimiter row
  [/^(?:={3,}|-{3,})\s*$/, 1], // setext underline or thematic break
];

const CODE_RULES: [RegExp, number][] = [
  [/[;{]\s*$/, 1], // statement or block end
  [/^\s*[}\])][;,)]*\s*$/, 1], // closing bracket line
  [
    /^\s*(?:import|export|const|let|var|function|class|def|return|package|using|public|private|protected|static|fn|func|struct|enum|interface|module|namespace|async|elif|except|#include|#define|#pragma)\b/,
    1,
  ],
  [/^\s*(?:if|for|while|switch|catch)\s*\(/, 1], // C-like control flow
  [/^\s*(?:if|elif|else|for|while|try|except|finally|with|def|class)\b[^\n]*:\s*$/, 1], // Python blocks
  [/^\s*(?:\/\/|\/\*|--\s)/, 1], // comments
  [/=>|::|->|!==|===|&&|\|\|/, 0.5], // operators
];

function score(lines: readonly string[], rules: readonly [RegExp, number][]): number {
  let total = 0;
  for (const line of lines) {
    for (const [re, weight] of rules) if (re.test(line)) total += weight;
  }
  return total;
}

function countOutside(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) count++;
  }
  return count;
}

/** True when most lines split into the same number (>= 2) of fields on one delimiter. */
function isDelimited(lines: readonly string[]): boolean {
  const rows = lines.slice(0, 50);
  if (rows.length < 2) return false;
  return [",", "\t", ";"].some((d) => {
    const first = countOutside(rows[0] as string, d);
    if (first < 1) return false;
    const same = rows.filter((row) => countOutside(row, d) === first).length;
    return same / rows.length >= 0.8;
  });
}

/** A line of running text: several words, no code punctuation at the end. */
function isProse(line: string): boolean {
  return /^\S+(?:\s+\S+){3,}/.test(line.trim()) && !/[;{}]\s*$/.test(line);
}

/**
 * Guesses the adapter id of a text document from its content.
 *
 * Strong signatures first (SVG/HTML prologs, glTF JSON, OBJ/STL geometry, shebang), then a
 * weighted vote between Markdown and code syntax, with delimiter consistency for CSV/TSV.
 * Text without clear signals is treated as prose (Markdown) when most lines read like
 * sentences and as plain text (code adapter) otherwise, so any readable text can be played.
 *
 * @param text Document text; only the first 16K characters are inspected.
 * @returns An adapter id, or `null` for empty input.
 */
export function classifyText(text: string): TextFormat | null {
  const head = text.slice(0, SAMPLE_CHARS).replace(/^﻿/, "").trimStart();
  if (!head) return null;
  if (SVG_RE.test(head)) return "svg";
  if (HTML_DOC_RE.test(head)) return "html";
  if (GLTF_RE.test(head) || STL_RE.test(head) || /^ply\r?\n/.test(head)) return "three";
  if (head.startsWith("#!") || head.startsWith("<?xml") || JSON_RE.test(head)) return "code";

  const lines = head.split(/\r?\n/, SAMPLE_LINES).filter((line) => line.trim() !== "");
  const uncommented = lines.filter((line) => !line.startsWith("#"));
  const geometry = uncommented.filter((line) => OBJ_LINE_RE.test(line)).length;
  if (geometry >= 3 && geometry >= uncommented.length * 0.9 && /^f\s/m.test(head)) return "three";

  const markdown = score(lines, MD_RULES);
  const code = score(lines, CODE_RULES);
  if (markdown < 2 && code < 2 && isDelimited(lines)) return "sheet";
  if (markdown >= 2 && markdown >= code) return "markdown";
  if (code >= 2 && code > markdown) return "code";
  if (head.startsWith("<") && HTML_TAG_RE.test(head)) return "html";
  return lines.filter(isProse).length * 2 >= lines.length ? "markdown" : "code";
}
