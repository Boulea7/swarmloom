import { DocxError } from "./errors";

/** Deepest element nesting accepted in an XML part (product-spec A.1). */
export const MAX_XML_DEPTH = 256;

/** WordprocessingML main namespace. */
export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** Office relationships namespace (r:id attributes). */
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const QUESTION = 0x3f;
const DQUOTE = 0x22;
const SQUOTE = 0x27;

/**
 * Rejects XML that Word never writes but parsers may act on: any `<!DOCTYPE`, `<!ENTITY` or other
 * markup declaration, and element nesting deeper than {@link MAX_XML_DEPTH}. One linear pass, no parsing.
 *
 * @throws DocxError "unsafe" naming the part.
 */
export function checkXml(text: string, part: string): void {
  let depth = 0;
  let at = text.indexOf("<");
  while (at >= 0) {
    const next = text.charCodeAt(at + 1);
    let end: number;
    if (next === SLASH) {
      depth--;
      end = text.indexOf(">", at + 2);
    } else if (next === QUESTION) {
      end = text.indexOf("?>", at + 2);
    } else if (next === BANG) {
      if (text.startsWith("<!--", at)) end = text.indexOf("-->", at + 4);
      else if (text.startsWith("<![CDATA[", at)) end = text.indexOf("]]>", at + 9);
      else throw new DocxError("unsafe", `markup declaration in ${part}`);
    } else {
      end = tagEnd(text, at + 1);
      if (end > 0 && text.charCodeAt(end - 1) !== SLASH && ++depth > MAX_XML_DEPTH) {
        throw new DocxError("unsafe", `${part} nests deeper than ${MAX_XML_DEPTH} levels`);
      }
    }
    if (end < 0) return; // Truncated markup: the XML parser reports it.
    at = text.indexOf("<", end + 1);
  }
}

/** Index of the `>` closing a start tag that begins at `from`, skipping quoted attribute values. */
function tagEnd(text: string, from: number): number {
  let quote = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === DQUOTE || c === SQUOTE) {
      quote = c;
    } else if (c === GT) {
      return i;
    } else if (c === LT) {
      return -1;
    }
  }
  return -1;
}

/**
 * Parses an XML part that already passed {@link checkXml}.
 *
 * @throws DocxError "corrupt" when the part is not well-formed.
 */
export function parseXml(text: string, part: string): Document {
  // The text is already decoded, so the declaration carries nothing; some DOM implementations reject
  // its single-quoted form, which python-docx and other writers emit.
  const body = text.replace(/^\uFEFF?\s*<\?xml\s[^>]*\?>/, "");
  const doc = new DOMParser().parseFromString(body, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) {
    throw new DocxError("corrupt", `${part} is not well-formed XML`);
  }
  return doc;
}

/**
 * Descendants of `root` with the given namespace and local name. Falls back to a scan when the DOM
 * does not index namespaced XML elements (happy-dom), so the parsers behave the same in tests.
 */
export function elementsNS(root: Document | Element, ns: string, name: string): Element[] {
  const found = Array.from(root.getElementsByTagNameNS(ns, name));
  if (found.length > 0) return found;
  return Array.from(root.getElementsByTagName("*")).filter((el) => el.namespaceURI === ns && el.localName === name);
}

/** Direct children of `el` in the WordprocessingML namespace with the given local name. */
export function wChildren(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name && c.namespaceURI === W_NS) out.push(c);
  }
  return out;
}

/** First direct WordprocessingML child named `name`, or null. */
export function wChild(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name && c.namespaceURI === W_NS) return c;
  }
  return null;
}

/** Value of a `w:`-namespaced attribute (Word also writes some unprefixed in older files). */
export function wAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`);
}

/** Integer value of a `w:` attribute, or `fallback` when absent or not a number. */
export function wInt(el: Element | null | undefined, name: string, fallback: number): number {
  const value = Number.parseInt(wAttr(el, name) ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

/** OOXML on/off property (`<w:b/>`, `<w:b w:val="0"/>`): present and not false. */
export function wToggle(rPr: Element | null, name: string): boolean {
  const el = wChild(rPr, name);
  if (!el) return false;
  const value = wAttr(el, "val");
  return value === null || !/^(?:0|false|off|none)$/i.test(value);
}
