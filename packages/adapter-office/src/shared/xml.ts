import { OfficeFormatError } from "./errors";
import type { ZipArchive } from "./zip";

/** Largest XML part we hand to the parser (characters). */
export const MAX_XML_CHARS = 48 * 1024 * 1024;

const DOCTYPE_RE = /<!DOCTYPE/i;

/**
 * Parses one XML part and returns its root element.
 *
 * Office parts never need a DTD, so any DOCTYPE is rejected up front: that rules out external
 * entities and entity-expansion bombs regardless of the browser's parser settings.
 *
 * @throws OfficeFormatError naming the part when it is too large, has a DOCTYPE or is malformed.
 */
export function parseXml(text: string, part: string): Element {
  if (text.length > MAX_XML_CHARS) throw new OfficeFormatError(`Part "${part}" is too large to read`);
  if (DOCTYPE_RE.test(text)) {
    throw new OfficeFormatError(`Part "${part}" declares a DOCTYPE, which is not allowed`);
  }
  const Parser = globalThis.DOMParser;
  if (!Parser) throw new OfficeFormatError("DOMParser is not available in this environment");
  const doc = new Parser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName === "parsererror" || doc.getElementsByTagName("parsererror").length > 0) {
    throw new OfficeFormatError(`Part "${part}" is not well-formed XML`);
  }
  return root;
}

/** Reads and parses a part from the package, or returns undefined when it does not exist. */
export function readXml(zip: ZipArchive, part: string): Element | undefined {
  return zip.has(part) ? parseXml(zip.readText(part), part) : undefined;
}

/** Child elements, optionally filtered by local name (namespace prefixes are ignored). */
export function kids(el: Element | undefined, local?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (local === undefined || c.localName === local) out.push(c);
  }
  return out;
}

/** First child element with the given local name. */
export function kid(el: Element | undefined, local: string): Element | undefined {
  if (!el) return undefined;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === local) return c;
  }
  return undefined;
}

/** Descends through first children with the given local names: `path(sp, "spPr", "xfrm")`. */
export function path(el: Element | undefined, ...locals: string[]): Element | undefined {
  let cur = el;
  for (const local of locals) cur = kid(cur, local);
  return cur;
}

/** Unprefixed attribute value, or undefined when absent. */
export function attr(el: Element | undefined, name: string): string | undefined {
  return el?.getAttribute(name) ?? undefined;
}

/**
 * Prefixed attribute by local name (e.g. `r:embed`, `table:style-name`), whatever prefix the
 * document chose. Falls back to scanning attribute names for parsers that are not namespace-aware.
 */
export function nsAttr(el: Element | undefined, local: string): string | undefined {
  if (!el) return undefined;
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    if (!a) continue;
    if (a.localName === local && a.prefix) return a.value;
    const colon = a.name.indexOf(":");
    if (colon > 0 && a.name.slice(colon + 1) === local) return a.value;
  }
  return undefined;
}

/** Integer attribute, or `fallback` when absent or not a finite number. */
export function intAttr(el: Element | undefined, name: string, fallback: number): number;
export function intAttr(el: Element | undefined, name: string): number | undefined;
export function intAttr(el: Element | undefined, name: string, fallback?: number): number | undefined {
  const raw = attr(el, name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Floating-point attribute, or `fallback`. */
export function numAttr(el: Element | undefined, name: string, fallback: number): number;
export function numAttr(el: Element | undefined, name: string): number | undefined;
export function numAttr(el: Element | undefined, name: string, fallback?: number): number | undefined {
  const raw = attr(el, name);
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** XML Schema boolean ("1"/"true"/"on" vs "0"/"false"/"off"), or `fallback`. */
export function boolAttr(el: Element | undefined, name: string, fallback: boolean): boolean;
export function boolAttr(el: Element | undefined, name: string): boolean | undefined;
export function boolAttr(el: Element | undefined, name: string, fallback?: boolean): boolean | undefined {
  const raw = attr(el, name);
  if (raw === undefined) return fallback;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return fallback;
}
