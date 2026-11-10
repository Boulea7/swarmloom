import { formatCounter } from "./numbering";
import { mapSymbolText } from "./symbols";

/** Class put on elements whose generated marker was replaced by a real span. */
export const MARKER_DONE_CLASS = "swl-marker-done";
/** Class of the materialized marker span. */
export const MARKER_CLASS = "swl-marker";

/** Hides the original ::before of materialized elements; include it in the sandbox (and blueprint) CSS. */
export const MARKER_CSS = `.${MARKER_DONE_CLASS}::before { content: none !important; }
.${MARKER_CLASS} { white-space: pre; text-indent: 0; }`;

type Token = { kind: "text"; value: string } | { kind: "counter"; name: string; style: string };

const SYMBOL_FONT = /symbol|wingdings|webdings/i;
const COPIED = ["font-family", "font-size", "font-weight", "font-style", "color"] as const;

/**
 * Replaces list markers generated with CSS counters in `::before` by real text spans.
 *
 * Snapshotting reads text from the DOM, and generated counter text is not readable from outside the
 * cascade, so numbered lists would lose their numbers. This walks `root` in document order, applies
 * `counter-reset`, `counter-set` and `counter-increment` of every element (and of the `::before` of
 * `selector` matches) and evaluates their `content`. Must run on laid-out, styled content.
 *
 * @returns The number of markers materialized (0 when computed styles are unavailable).
 */
export function materializeMarkers(root: HTMLElement, selector = "p"): number {
  const view = root.ownerDocument.defaultView;
  if (!view) return 0;
  const counters = new Map<string, number>();
  const walker = root.ownerDocument.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
  const done: { el: Element; text: string; css: Record<string, string> }[] = [];
  for (let el = walker.nextNode() as Element | null; el; el = walker.nextNode() as Element | null) {
    const cs = view.getComputedStyle(el);
    applyCounters(counters, cs);
    if (!el.matches(selector)) continue;
    const before = view.getComputedStyle(el, "::before");
    const tokens = parseContent(before.content);
    if (!tokens?.some((t) => t.kind === "counter" || t.value.trim() !== "")) continue;
    applyCounters(counters, before);
    const symbolFont = SYMBOL_FONT.test(before.fontFamily);
    let text = "";
    for (const t of tokens) text += t.kind === "text" ? t.value : formatCounter(counters.get(t.name) ?? 0, t.style);
    text = mapSymbolText(text)
      .replace(/[\t ]+$/, " ")
      .replace(/\t/g, " ");
    const css: Record<string, string> = {};
    for (const prop of COPIED) {
      if (prop === "font-family" && symbolFont) continue;
      const value = before.getPropertyValue(prop);
      if (value && value !== cs.getPropertyValue(prop)) css[prop] = value;
    }
    done.push({ el, text, css });
  }
  // Writes after all reads, so the walk above never forces a style recalculation per element.
  for (const { el, text, css } of done) {
    const span = el.ownerDocument.createElement("span");
    span.className = MARKER_CLASS;
    span.setAttribute("aria-hidden", "true");
    for (const [prop, value] of Object.entries(css)) span.style.setProperty(prop, value);
    span.textContent = text;
    el.prepend(span);
    el.classList.add(MARKER_DONE_CLASS);
  }
  return done.length;
}

/** Applies reset, then set, then increment (CSS Lists 3 order) from one computed style. */
function applyCounters(counters: Map<string, number>, cs: CSSStyleDeclaration): void {
  for (const [name, n] of counterPairs(cs.getPropertyValue("counter-reset"), 0)) counters.set(name, n);
  for (const [name, n] of counterPairs(cs.getPropertyValue("counter-set"), 0)) counters.set(name, n);
  for (const [name, n] of counterPairs(cs.getPropertyValue("counter-increment"), 1)) {
    counters.set(name, (counters.get(name) ?? 0) + n);
  }
}

/** Parses "name [int] name2 [int]" counter lists; `none` and empty values yield nothing. */
export function counterPairs(value: string, fallback: number): [string, number][] {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "" || parts[0] === "none") return [];
  const out: [string, number][] = [];
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const next = parts[i + 1];
    if (next !== undefined && /^[+-]?\d+$/.test(next)) {
      out.push([name, Number(next)]);
      i++;
    } else {
      out.push([name, fallback]);
    }
  }
  return out;
}

/**
 * Tokenizes a computed `content` value into strings and `counter()` references. Returns null for
 * `none`/`normal` and for values with parts that cannot be evaluated (images, attr(), quotes).
 */
export function parseContent(value: string): Token[] | null {
  const v = value.trim();
  if (v === "" || v === "none" || v === "normal") return null;
  const tokens: Token[] = [];
  let i = 0;
  while (i < v.length) {
    const ch = v[i];
    if (ch === " ") {
      i++;
    } else if (ch === '"' || ch === "'") {
      const [text, end] = readString(v, i);
      tokens.push({ kind: "text", value: text });
      i = end;
    } else if (v.startsWith("counter(", i)) {
      const close = v.indexOf(")", i);
      if (close < 0) return null;
      const [name, style] = v
        .slice(i + 8, close)
        .split(",")
        .map((s) => s.trim());
      if (!name) return null;
      tokens.push({ kind: "counter", name, style: style || "decimal" });
      i = close + 1;
    } else {
      return null;
    }
  }
  return tokens;
}

/** Reads a CSS string starting at the quote at `start`; returns its value and the index after it. */
function readString(value: string, start: number): [string, number] {
  const quote = value[start];
  let out = "";
  let i = start + 1;
  while (i < value.length) {
    const ch = value[i];
    if (ch === quote) return [out, i + 1];
    if (ch === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(value.slice(i + 1, i + 7));
      if (hex) {
        const cp = Number.parseInt(hex[0], 16);
        out += cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
        i += 1 + hex[0].length;
        if (value[i] === " ") i++;
        continue;
      }
      if (i + 1 < value.length) out += value[i + 1];
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return [out, i];
}
