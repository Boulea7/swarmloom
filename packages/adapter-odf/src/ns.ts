/** OpenDocument namespaces (ODF 1.2/1.3) and the prefixes they are written with by convention. */
export const NS = {
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
  draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  svg: "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
  xlink: "http://www.w3.org/1999/xlink",
  presentation: "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
  manifest: "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
  meta: "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
  dc: "http://purl.org/dc/elements/1.1/",
} as const;

export type Prefix = keyof typeof NS;

const PREFIX_OF = new Map<string, string>(Object.entries(NS).map(([prefix, uri]) => [uri, prefix]));

/**
 * Reads an ODF attribute by its conventional qualified name ("text:style-name"). Uses the
 * namespace when the DOM tracks it and the written name otherwise.
 */
export function a(el: Element, qname: `${Prefix}:${string}`): string | null {
  const colon = qname.indexOf(":");
  const prefix = qname.slice(0, colon) as Prefix;
  return el.getAttributeNS(NS[prefix], qname.slice(colon + 1)) ?? el.getAttribute(qname);
}

/** Conventional qualified name of an attribute node ("fo:font-size"), whatever prefix the file used. */
export function qualifiedName(attr: Attr): string {
  const prefix = attr.namespaceURI ? PREFIX_OF.get(attr.namespaceURI) : undefined;
  return prefix ? `${prefix}:${attr.localName}` : attr.name;
}

/** True when `el` is `prefix:local`. */
export function isOdf(el: Element | null | undefined, prefix: Prefix, local: string): boolean {
  return !!el && el.localName === local && el.namespaceURI === NS[prefix];
}

/** Element children named `prefix:local`. */
export function children(el: Element, prefix: Prefix, local: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (isOdf(c, prefix, local)) out.push(c);
  return out;
}

/** First element child named `prefix:local`. */
export function child(el: Element | null | undefined, prefix: Prefix, local: string): Element | undefined {
  if (!el) return undefined;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (isOdf(c, prefix, local)) return c;
  return undefined;
}
