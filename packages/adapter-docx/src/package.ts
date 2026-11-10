import type JSZip from "jszip";
import { DocxError } from "./errors";
import { checkXml, elementsNS, parseXml, W_NS, wAttr, wChild } from "./xml";
import { checkDocxPackage, type ZipLimits } from "./zip";

const OFFICE_DOCUMENT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const STRICT_OFFICE_DOCUMENT = "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument";
const XML_PART = /\.(?:xml|rels)$/i;

/** A Word package whose ZIP directory and XML parts passed the safety checks. */
export interface DocxPackage {
  /** Path of the main document part, e.g. "word/document.xml". */
  readonly main: string;
  /** Text of an XML part (already checked), or null when the package has no such part. */
  xml(path: string): string | null;
  /** Raw bytes of a binary part (images), or null. */
  binary(path: string): Promise<Uint8Array | null>;
  /** Relationship targets of a part, keyed by r:id, with absolute package paths for internal targets. */
  rels(part: string): Map<string, { target: string; external: boolean; type: string }>;
}

/**
 * Validates and opens a DOCX: ZIP limits and entry names (central directory, before inflating anything),
 * then every XML part is inflated once and checked for DTDs and nesting depth.
 *
 * @throws DocxError for non-Word, encrypted, oversized, damaged or unsafe packages.
 */
export async function openDocxPackage(bytes: Uint8Array, limits?: ZipLimits): Promise<DocxPackage> {
  checkDocxPackage(bytes, limits);
  const { default: JSZipClass } = await import("jszip");
  let zip: JSZip;
  try {
    zip = await JSZipClass.loadAsync(bytes, { checkCRC32: true });
  } catch (cause) {
    throw new DocxError("corrupt", "the ZIP container could not be read", { cause });
  }
  const texts = new Map<string, string>();
  const files = Object.values(zip.files).filter((f) => !f.dir && XML_PART.test(f.name));
  for (const file of files) {
    let text: string;
    try {
      text = await file.async("string");
    } catch (cause) {
      throw new DocxError("corrupt", `${file.name} could not be unpacked`, { cause });
    }
    checkXml(text, file.name);
    texts.set(file.name, text);
  }
  const relCache = new Map<string, ReturnType<DocxPackage["rels"]>>();
  const pkg: DocxPackage = {
    main: "",
    xml: (path) => texts.get(path) ?? null,
    async binary(path) {
      const file = zip.file(path);
      return file ? file.async("uint8array") : null;
    },
    rels(part) {
      let map = relCache.get(part);
      if (!map) {
        map = readRels(texts, part);
        relCache.set(part, map);
      }
      return map;
    },
  };
  const main = [...pkg.rels("").values()].find((r) => r.type === OFFICE_DOCUMENT || r.type === STRICT_OFFICE_DOCUMENT);
  const mainPath = main && !main.external ? main.target : "word/document.xml";
  if (!texts.has(mainPath)) throw new DocxError("not-docx", "no Word main document");
  return { ...pkg, main: mainPath };
}

function relsPath(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** Resolves a relationship target against the folder of its source part (package paths have no leading slash). */
export function resolvePartPath(part: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = part.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") segments.pop();
    else if (piece !== "." && piece !== "") segments.push(piece);
  }
  return segments.join("/");
}

function readRels(texts: ReadonlyMap<string, string>, part: string): ReturnType<DocxPackage["rels"]> {
  const out: ReturnType<DocxPackage["rels"]> = new Map();
  const path = part === "" ? "_rels/.rels" : relsPath(part);
  const text = texts.get(path);
  if (!text) return out;
  const doc = parseXml(text, path);
  for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) continue;
    const external = rel.getAttribute("TargetMode") === "External";
    out.set(id, {
      type: rel.getAttribute("Type") ?? "",
      external,
      target: external ? target : resolvePartPath(part, target),
    });
  }
  return out;
}

/** A paragraph style that maps to a heading level (1..9); Title maps to level 1 with `title` set. */
export interface HeadingStyle {
  level: number;
  title: boolean;
}

/** What the renderers need to know about a paragraph style, with w:basedOn inheritance applied. */
export interface ParagraphStyle {
  heading: HeadingStyle | null;
  /** List numbering (w:numId, w:ilvl) defined by the style itself. */
  numbering: { numId: string; ilvl: number } | null;
}

const HEADING_NAME = /^heading\s*([1-9])$/i;
const MAX_BASED_ON = 32;

/** Path of a part related to the main document by relationship type suffix ("/styles", "/numbering"). */
export function relatedPart(pkg: DocxPackage, typeSuffix: string, fallback: string): string {
  return [...pkg.rels(pkg.main).values()].find((r) => !r.external && r.type.endsWith(typeSuffix))?.target ?? fallback;
}

/**
 * Paragraph styles of the styles part keyed by style id. Headings come from the built-in names
 * ("heading 1".."heading 9", "Title": w:name is language-independent) or an outline level.
 */
export function paragraphStyles(pkg: DocxPackage): Map<string, ParagraphStyle> {
  const out = new Map<string, ParagraphStyle>();
  const path = relatedPart(pkg, "/styles", "word/styles.xml");
  const text = pkg.xml(path);
  if (!text) return out;
  const doc = parseXml(text, path);
  type Own = { heading: HeadingStyle | null; numbering: ParagraphStyle["numbering"]; basedOn: string | null };
  const own = new Map<string, Own>();
  for (const style of elementsNS(doc, W_NS, "style")) {
    if (wAttr(style, "type") !== "paragraph") continue;
    const id = wAttr(style, "styleId");
    if (!id) continue;
    const name = (wAttr(wChild(style, "name"), "val") ?? "").trim();
    const pPr = wChild(style, "pPr");
    const outline = wAttr(wChild(pPr, "outlineLvl"), "val");
    const match = HEADING_NAME.exec(name);
    let heading: HeadingStyle | null = null;
    if (/^title$/i.test(name)) heading = { level: 1, title: true };
    else if (match) heading = { level: Number(match[1]), title: false };
    else if (outline !== null && /^[0-8]$/.test(outline)) heading = { level: Number(outline) + 1, title: false };
    const numPr = wChild(pPr, "numPr");
    const numId = wAttr(wChild(numPr, "numId"), "val");
    const numbering =
      numId && numId !== "0" ? { numId, ilvl: Number(wAttr(wChild(numPr, "ilvl"), "val") ?? 0) || 0 } : null;
    own.set(id, { heading, numbering, basedOn: wAttr(wChild(style, "basedOn"), "val") });
  }
  const inherited = <K extends "heading" | "numbering">(id: string, key: K): Own[K] | null => {
    let current: string | null = id;
    for (let hops = 0; current && hops < MAX_BASED_ON; hops++) {
      const entry = own.get(current);
      if (!entry) break;
      if (entry[key]) return entry[key];
      current = entry.basedOn;
    }
    return null;
  };
  for (const id of own.keys())
    out.set(id, { heading: inherited(id, "heading"), numbering: inherited(id, "numbering") });
  return out;
}

/** Heading paragraph styles only, keyed by style id. */
export function headingStyles(styles: ReadonlyMap<string, ParagraphStyle>): Map<string, HeadingStyle> {
  const out = new Map<string, HeadingStyle>();
  for (const [id, style] of styles) if (style.heading) out.set(id, style.heading);
  return out;
}

/** `dc:title` of docProps/core.xml, when set. */
export function coreTitle(pkg: DocxPackage): string | undefined {
  const text = pkg.xml("docProps/core.xml");
  if (!text) return undefined;
  const doc = parseXml(text, "docProps/core.xml");
  const title = elementsNS(doc, "http://purl.org/dc/elements/1.1/", "title")[0]?.textContent?.trim();
  return title ? title.slice(0, 200) : undefined;
}
