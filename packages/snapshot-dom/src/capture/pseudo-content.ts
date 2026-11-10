/**
 * Parser for computed `content` values of ::before/::after.
 * Supports strings (with CSS escapes), url(), attr(), quotes and the `/ alt` suffix.
 * Counters cannot be evaluated from outside the cascade and contribute nothing.
 */
export interface PseudoContent {
  text: string;
  /** First url() image, if any. */
  image: string | null;
}

function readString(value: string, start: number): [string, number] {
  const quote = value[start];
  let out = "";
  let i = start + 1;
  while (i < value.length) {
    const ch = value[i] as string;
    if (ch === quote) return [out, i + 1];
    if (ch === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(value.slice(i + 1, i + 7));
      if (hex) {
        const cp = Number.parseInt(hex[0], 16);
        out += cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
        i += 1 + hex[0].length;
        if (value[i] === " " || value[i] === "\t" || value[i] === "\n") i++;
        continue;
      }
      if (value[i + 1] === "\n") {
        i += 2;
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

function matchParen(value: string, open: number): number {
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      i = readString(value, i)[1] - 1;
    } else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return value.length - 1;
}

/**
 * Parses a computed `content` value. Returns null for `none`/`normal` (no box is generated).
 * `getAttr` resolves attr() references against the host element.
 */
export function parsePseudoContent(value: string, getAttr: (name: string) => string | null): PseudoContent | null {
  const v = value.trim();
  if (v === "" || v === "none" || v === "normal") return null;
  let text = "";
  let image: string | null = null;
  let i = 0;
  while (i < v.length) {
    const ch = v[i] as string;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === ",") {
      i++;
      continue;
    }
    // `content: "x" / "alt text"`: the alternative text is not rendered.
    if (ch === "/") break;
    if (ch === '"' || ch === "'") {
      const [s, next] = readString(v, i);
      text += s;
      i = next;
      continue;
    }
    const ident = /^[a-zA-Z-]+/.exec(v.slice(i));
    if (!ident) {
      i++;
      continue;
    }
    const word = ident[0].toLowerCase();
    const after = i + ident[0].length;
    if (v[after] === "(") {
      const close = matchParen(v, after);
      const inner = v.slice(after + 1, close).trim();
      if (word === "url" && image === null) {
        image = inner.startsWith('"') || inner.startsWith("'") ? readString(inner, 0)[0] : inner;
      } else if (word === "attr") {
        const name = inner.split(/[\s,]/)[0] ?? "";
        text += getAttr(name) ?? "";
      }
      i = close + 1;
      continue;
    }
    if (word === "open-quote") text += "“";
    else if (word === "close-quote") text += "”";
    i = after;
  }
  return { text, image };
}
