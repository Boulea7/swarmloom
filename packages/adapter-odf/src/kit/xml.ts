import { DocumentError } from "./errors";

/** Safety limits for XML parts (product-spec A.1). */
export interface XmlLimits {
  /** Most UTF-16 code units of one part. */
  maxChars: number;
  /** Deepest element nesting. */
  maxDepth: number;
  /** Most elements in one part. */
  maxElements: number;
}

export const XML_LIMITS: Readonly<XmlLimits> = {
  maxChars: 64 * 1024 * 1024,
  maxDepth: 256,
  maxElements: 1_000_000,
};

/** Options of {@link parseXml}. */
export interface ParseXmlOptions {
  /** Adapter id for error messages. */
  format: string;
  /** Part name for error messages ("content.xml"). */
  part: string;
  /** Window (of the adapter context document) whose DOMParser is used. Default: the global one. */
  window?: object | null;
  /**
   * MIME type handed to DOMParser. Default "application/xml".
   * XHTML documents (EPUB) pass "application/xhtml+xml".
   */
  type?: DOMParserSupportedType;
  /** Remove a DOCTYPE without an internal subset instead of rejecting it (XHTML). Default false. */
  stripDoctype?: boolean;
  limits?: Partial<XmlLimits>;
}

const DOCTYPE = /<!DOCTYPE\b[^>[]*>/i;

/**
 * Parses an XML part with the browser's DOMParser after the A.1 checks: DTDs and entity
 * declarations are refused (no part of ODF, OFD or OPF needs them), and depth and element counts are
 * limited after parsing.
 *
 * @throws DocumentError `malformed` for DTDs or syntax errors, `too-large` for limit violations.
 */
export function parseXml(text: string, opts: ParseXmlOptions): Document {
  const limits = { ...XML_LIMITS, ...opts.limits };
  const fail = (code: "malformed" | "too-large", why: string) =>
    new DocumentError(opts.format, code, `${opts.part}: ${why}`);
  if (text.length > limits.maxChars) throw fail("too-large", `larger than ${limits.maxChars} characters`);
  let source = text;
  if (opts.stripDoctype) source = source.replace(DOCTYPE, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw fail("malformed", "document type declarations are not allowed");
  const Parser =
    (opts.window as { DOMParser?: typeof DOMParser } | null | undefined)?.DOMParser ?? globalThis.DOMParser;
  if (typeof Parser !== "function") throw new TypeError(`${opts.format}: DOMParser is not available`);
  const doc = new Parser().parseFromString(source, opts.type ?? "application/xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length > 0) throw fail("malformed", "not well-formed XML");
  checkShape(root, limits, fail);
  return doc;
}

function checkShape(
  root: Element,
  limits: XmlLimits,
  fail: (code: "malformed" | "too-large", why: string) => DocumentError,
): void {
  let count = 0;
  const stack: [Element, number][] = [[root, 1]];
  while (stack.length > 0) {
    const [el, depth] = stack.pop() as [Element, number];
    if (++count > limits.maxElements) throw fail("too-large", `more than ${limits.maxElements} elements`);
    if (depth > limits.maxDepth) throw fail("too-large", `nested deeper than ${limits.maxDepth} levels`);
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push([c, depth + 1]);
  }
}

/** True when `el` has local name `local` and (when given) namespace `ns`. */
export function is(el: Element | null | undefined, ns: string | null, local: string): boolean {
  return !!el && el.localName === local && (ns === null || el.namespaceURI === ns);
}

/** Element children of `el`, optionally filtered by namespace and local name. */
export function kids(el: Element, ns: string | null = null, local?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (local === undefined || is(c, ns, local)) out.push(c);
  }
  return out;
}

/** First element child with the given name. */
export function kid(el: Element | null | undefined, ns: string | null, local: string): Element | undefined {
  if (!el) return undefined;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (is(c, ns, local)) return c;
  return undefined;
}

/** Descendants with the given name, in document order (iterative, no recursion). */
export function descendants(el: Element, ns: string | null, local: string): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [];
  for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  while (stack.length > 0) {
    const e = stack.pop() as Element;
    if (is(e, ns, local)) out.push(e);
    for (let c = e.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  }
  return out;
}

/**
 * Reads a namespaced attribute. `qname` carries the conventional prefix ("text:style-name"), used
 * as a fallback for DOM implementations that do not track attribute namespaces.
 */
export function attr(el: Element, ns: string, qname: string): string | null {
  const colon = qname.indexOf(":");
  const local = colon >= 0 ? qname.slice(colon + 1) : qname;
  return el.getAttributeNS(ns, local) ?? el.getAttribute(qname);
}
