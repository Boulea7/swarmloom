import {
  DocumentError,
  descendants,
  kid,
  kids,
  parseXml,
  resolvePath,
  type ZipArchive,
} from "@swarmloom/adapter-odf/kit";

const FORMAT = "epub";

/** A manifest item of the package document. */
export interface ManifestItem {
  id: string;
  /** Path inside the archive (resolved against the OPF). */
  path: string;
  mediaType: string;
  properties: string[];
}

/** One entry of the spine (reading order). */
export interface SpineItem {
  item: ManifestItem;
  /** `linear="no"` items (pop-ups, notes) are auxiliary. */
  linear: boolean;
}

/** An entry of the table of contents. */
export interface TocEntry {
  label: string;
  depth: number;
}

/** What the adapter needs from an EPUB package. */
export interface Book {
  opfPath: string;
  title?: string;
  creator?: string;
  language?: string;
  /** EPUB 3 `rendition:layout` of `pre-paginated` (fixed layout). */
  fixedLayout: boolean;
  /** Fixed-layout viewport from `rendition:viewport`, when declared. */
  viewport?: { w: number; h: number };
  manifest: Map<string, ManifestItem>;
  spine: SpineItem[];
  /** Path of the cover image, when declared. */
  coverImage?: string;
  toc: TocEntry[];
  /** Archive paths of font files that are obfuscated (they are not loaded). */
  obfuscatedFonts: Set<string>;
}

/** Font obfuscation algorithms (IDPF and Adobe). They hide fonts, not content, so books stay readable. */
const FONT_OBFUSCATION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);
const FONT_FILE = /\.(?:otf|ttf|woff2?|eot)$/i;

function xml(zip: ZipArchive, path: string, win: object | null): Document {
  return parseXml(zip.text(path), { format: FORMAT, part: path, window: win });
}

/**
 * Reads META-INF/encryption.xml. Obfuscated fonts are collected; any other encrypted resource
 * means DRM.
 *
 * @throws DocumentError `encrypted` for DRM-protected books.
 */
function readEncryption(zip: ZipArchive, win: object | null): Set<string> {
  const fonts = new Set<string>();
  if (!zip.has("META-INF/encryption.xml")) return fonts;
  const doc = xml(zip, "META-INF/encryption.xml", win);
  for (const data of descendants(doc.documentElement, null, "EncryptedData")) {
    const algorithm = kid(data, null, "EncryptionMethod")?.getAttribute("Algorithm") ?? "";
    const uri = kid(kid(data, null, "CipherData"), null, "CipherReference")?.getAttribute("URI") ?? "";
    const path = resolvePath("", uri);
    if (FONT_OBFUSCATION.has(algorithm) && path && FONT_FILE.test(path)) {
      fonts.add(path);
      continue;
    }
    throw new DocumentError(FORMAT, "encrypted", "the book is DRM-protected (its content is encrypted)");
  }
  return fonts;
}

function rootfile(zip: ZipArchive, win: object | null): string {
  if (!zip.has("META-INF/container.xml"))
    throw new DocumentError(FORMAT, "malformed", "META-INF/container.xml is missing");
  const container = xml(zip, "META-INF/container.xml", win);
  const files = descendants(container.documentElement, null, "rootfile");
  const opf =
    files.find((f) => (f.getAttribute("media-type") ?? "").trim() === "application/oebps-package+xml") ?? files[0];
  const path = resolvePath("", opf?.getAttribute("full-path") ?? "");
  if (!path || !zip.has(path))
    throw new DocumentError(FORMAT, "malformed", "the package document named in container.xml is missing");
  return path;
}

function text(el: Element | undefined): string | undefined {
  const t = el?.textContent?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

function viewportOf(value: string | null | undefined): { w: number; h: number } | undefined {
  const w = /width\s*=\s*(\d+(?:\.\d+)?)/i.exec(value ?? "");
  const h = /height\s*=\s*(\d+(?:\.\d+)?)/i.exec(value ?? "");
  if (!w || !h) return undefined;
  const size = { w: Number(w[1]), h: Number(h[1]) };
  return size.w >= 50 && size.h >= 50 && size.w <= 4000 && size.h <= 6000 ? size : undefined;
}

/** Reads the EPUB 3 navigation document (`nav epub:type="toc"`). */
function navToc(doc: Document): TocEntry[] {
  const navs = descendants(doc.documentElement, null, "nav");
  const toc =
    navs.find((n) =>
      /\btoc\b/.test(n.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? n.getAttribute("epub:type") ?? ""),
    ) ?? navs[0];
  const out: TocEntry[] = [];
  const walk = (list: Element | undefined, depth: number) => {
    if (!list) return;
    for (const li of kids(list, null, "li")) {
      const label = text(kid(li, null, "a") ?? kid(li, null, "span"));
      if (label) out.push({ label, depth });
      walk(kid(li, null, "ol") ?? kid(li, null, "ul"), depth + 1);
    }
  };
  if (toc) walk(kid(toc, null, "ol") ?? kid(toc, null, "ul"), 0);
  return out;
}

/** Reads the EPUB 2 NCX navigation map. */
function ncxToc(doc: Document): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (el: Element | undefined, depth: number) => {
    if (!el) return;
    for (const point of kids(el, null, "navPoint")) {
      const label = text(kid(kid(point, null, "navLabel"), null, "text"));
      if (label) out.push({ label, depth });
      walk(point, depth + 1);
    }
  };
  walk(kid(doc.documentElement, null, "navMap"), 0);
  return out;
}

function readToc(
  zip: ZipArchive,
  win: object | null,
  manifest: Map<string, ManifestItem>,
  ncxId: string | null,
): TocEntry[] {
  try {
    const nav = [...manifest.values()].find((m) => m.properties.includes("nav"));
    if (nav && zip.has(nav.path)) {
      const entries = navToc(
        parseXml(zip.text(nav.path), { format: FORMAT, part: nav.path, window: win, stripDoctype: true }),
      );
      if (entries.length > 0) return entries;
    }
    const ncx =
      (ncxId ? manifest.get(ncxId) : undefined) ??
      [...manifest.values()].find((m) => m.mediaType === "application/x-dtbncx+xml");
    if (ncx && zip.has(ncx.path))
      return ncxToc(parseXml(zip.text(ncx.path), { format: FORMAT, part: ncx.path, window: win, stripDoctype: true }));
  } catch (error) {
    // The outline is informational: a broken nav document must not stop the book from loading.
    if (!(error instanceof DocumentError)) throw error;
  }
  return [];
}

/**
 * Opens the package: encryption check, container.xml, the OPF (metadata, manifest, spine,
 * cover, layout) and the table of contents.
 *
 * @throws DocumentError `encrypted` for DRM, `malformed` for broken or incomplete packages.
 */
export function readBook(zip: ZipArchive, win: object | null): Book {
  const mimetype = zip.has("mimetype") ? zip.mimetype() : undefined;
  if (mimetype !== undefined && mimetype !== "application/epub+zip") {
    throw new DocumentError(FORMAT, "unsupported", `not an EPUB (mimetype "${mimetype}")`);
  }
  const obfuscatedFonts = readEncryption(zip, win);
  const opfPath = rootfile(zip, win);
  const opf = xml(zip, opfPath, win).documentElement;
  const metadata = kid(opf, null, "metadata");
  const manifest = new Map<string, ManifestItem>();
  for (const el of kids(kid(opf, null, "manifest") ?? opf, null, "item")) {
    const id = el.getAttribute("id");
    const path = resolvePath(opfPath, el.getAttribute("href") ?? "");
    if (!id || !path) continue;
    const properties = (el.getAttribute("properties") ?? "").split(/\s+/).filter((p) => p);
    manifest.set(id, { id, path, mediaType: (el.getAttribute("media-type") ?? "").trim().toLowerCase(), properties });
  }
  const spineEl = kid(opf, null, "spine");
  const spine: SpineItem[] = [];
  for (const ref of kids(spineEl ?? opf, null, "itemref")) {
    const item = manifest.get(ref.getAttribute("idref") ?? "");
    if (item) spine.push({ item, linear: ref.getAttribute("linear") !== "no" });
  }
  if (spine.length === 0) throw new DocumentError(FORMAT, "malformed", "the spine lists no content documents");
  const metas = metadata ? kids(metadata, null, "meta") : [];
  const prop = (name: string) => text(metas.find((m) => m.getAttribute("property") === name));
  const coverId = metas.find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
  const cover =
    [...manifest.values()].find((m) => m.properties.includes("cover-image")) ??
    (coverId ? manifest.get(coverId) : undefined);
  const book: Book = {
    opfPath,
    fixedLayout: prop("rendition:layout") === "pre-paginated",
    manifest,
    spine,
    toc: readToc(zip, win, manifest, spineEl?.getAttribute("toc") ?? null),
    obfuscatedFonts,
  };
  const title = text(metadata ? kid(metadata, null, "title") : undefined);
  const creator = text(metadata ? kid(metadata, null, "creator") : undefined);
  const language = text(metadata ? kid(metadata, null, "language") : undefined);
  const viewport = viewportOf(prop("rendition:viewport"));
  if (title) book.title = title;
  if (creator) book.creator = creator;
  if (language && /^[a-z]{2,3}(?:-[a-z0-9-]+)?$/i.test(language)) book.language = language;
  if (viewport) book.viewport = viewport;
  if (cover?.mediaType.startsWith("image/")) book.coverImage = cover.path;
  return book;
}

/** Viewport declared by a fixed-layout content document (`<meta name="viewport">`). */
export function documentViewport(doc: Document): { w: number; h: number } | undefined {
  const meta = descendants(doc.documentElement, null, "meta").find((m) => m.getAttribute("name") === "viewport");
  return viewportOf(meta?.getAttribute("content"));
}
