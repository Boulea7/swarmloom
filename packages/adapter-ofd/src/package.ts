import {
  DocumentError,
  descendants,
  kid,
  kids,
  parseXml,
  resolvePath,
  type ZipArchive,
} from "@swarmloom/adapter-odf/kit";

const FORMAT = "ofd";

/** A box in millimetres. */
export interface MmBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A font resource. */
export interface OfdFont {
  name: string;
  family?: string;
  bold?: boolean;
  italic?: boolean;
  /** The package embeds the font file (not loaded; the F01 fallback is used). */
  embedded?: boolean;
}

/** A page of the document: its content part and its own area, when set. */
export interface OfdPageRef {
  id: string;
  path: string;
}

/** What the renderer needs from an OFD package. */
export interface OfdPackage {
  zip: ZipArchive;
  title?: string;
  /** Path of Document.xml. */
  documentPath: string;
  /** Default page area (`CommonData/PageArea/PhysicalBox`). */
  pageBox: MmBox;
  pages: OfdPageRef[];
  /** Template pages by ID: content part path. */
  templates: Map<string, string>;
  fonts: Map<string, OfdFont>;
  /** Multimedia resources by ID: archive path of the file. */
  media: Map<string, string>;
  /** Composite graphic units, drawing parameters and other resources are counted, not drawn. */
  signed: boolean;
  annotated: boolean;
}

const A4: MmBox = { x: 0, y: 0, w: 210, h: 297 };

/** Parses "x y w h" in millimetres; undefined unless all four are finite and the size positive. */
export function parseBox(value: string | null | undefined): MmBox | undefined {
  const n = (value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return undefined;
  const [x, y, w, h] = n as [number, number, number, number];
  return w > 0 && h > 0 && w < 10_000 && h < 10_000 ? { x, y, w, h } : undefined;
}

function xml(zip: ZipArchive, path: string, win: object | null): Element {
  if (!zip.has(path)) throw new DocumentError(FORMAT, "malformed", `${path} is missing`);
  return parseXml(zip.text(path), { format: FORMAT, part: path, window: win }).documentElement;
}

/** Text of a child element (namespace-agnostic). */
function childText(el: Element | undefined, local: string): string | undefined {
  const t = kid(el, null, local)?.textContent?.trim();
  return t ? t : undefined;
}

/**
 * Reads resource files (`PublicRes`, `DocumentRes`): fonts and multimedia, with paths resolved
 * against each file's `BaseLoc`.
 */
function readResources(
  zip: ZipArchive,
  path: string,
  win: object | null,
  pkg: Pick<OfdPackage, "fonts" | "media">,
): void {
  if (!zip.has(path)) return;
  const res = xml(zip, path, win);
  const base = res.getAttribute("BaseLoc");
  // Media files resolve against BaseLoc, itself relative to the resource file.
  const dir = base ? resolvePath(path, base) : null;
  const baseDir = dir ? `${dir}/` : path;
  for (const font of descendants(res, null, "Font")) {
    const id = font.getAttribute("ID");
    const name = font.getAttribute("FontName")?.trim();
    if (!id || !name) continue;
    const entry: OfdFont = { name };
    const family = font.getAttribute("FamilyName")?.trim();
    if (family) entry.family = family;
    if (font.getAttribute("Bold") === "true") entry.bold = true;
    if (font.getAttribute("Italic") === "true") entry.italic = true;
    if (kid(font, null, "FontFile")) entry.embedded = true;
    pkg.fonts.set(id, entry);
  }
  for (const media of descendants(res, null, "MultiMedia")) {
    const id = media.getAttribute("ID");
    const file = childText(media, "MediaFile");
    if (!id || !file) continue;
    const resolved = resolvePath(baseDir, file);
    if (resolved) pkg.media.set(id, resolved);
  }
}

/**
 * Opens an OFD package (GB/T 33190): OFD.xml -> DocBody/DocRoot -> Document.xml (page area,
 * resources, template pages, page list).
 *
 * @throws DocumentError `malformed` for a missing or broken OFD.xml or Document.xml.
 */
export function openOfd(zip: ZipArchive, win: object | null): OfdPackage {
  if (!zip.has("OFD.xml")) throw new DocumentError(FORMAT, "malformed", "OFD.xml is missing (not an OFD package)");
  const root = xml(zip, "OFD.xml", win);
  const body = kids(root, null, "DocBody")[0];
  const docRoot = childText(body, "DocRoot");
  const documentPath = docRoot ? resolvePath("", docRoot) : null;
  if (!body || !documentPath) throw new DocumentError(FORMAT, "malformed", "OFD.xml names no DocRoot");
  const doc = xml(zip, documentPath, win);
  const common = kid(doc, null, "CommonData");
  const pkg: OfdPackage = {
    zip,
    documentPath,
    pageBox: parseBox(childText(kid(common, null, "PageArea"), "PhysicalBox")) ?? A4,
    pages: [],
    templates: new Map(),
    fonts: new Map(),
    media: new Map(),
    signed: !!childText(body, "Signatures"),
    annotated: !!kid(doc, null, "Annotations"),
  };
  const title = childText(kid(body, null, "DocInfo"), "Title");
  if (title) pkg.title = title;
  const at = (loc: string | null | undefined) => (loc ? resolvePath(documentPath, loc) : null);
  for (const local of ["PublicRes", "DocumentRes"]) {
    for (const el of kids(common ?? doc, null, local)) {
      const path = at(el.textContent?.trim());
      if (path) readResources(zip, path, win, pkg);
    }
  }
  for (const tpl of kids(common ?? doc, null, "TemplatePage")) {
    const id = tpl.getAttribute("ID");
    const path = at(tpl.getAttribute("BaseLoc"));
    if (id && path && zip.has(path)) pkg.templates.set(id, path);
  }
  for (const page of kids(kid(doc, null, "Pages") ?? doc, null, "Page")) {
    const path = at(page.getAttribute("BaseLoc"));
    if (path && zip.has(path)) pkg.pages.push({ id: page.getAttribute("ID") ?? String(pkg.pages.length + 1), path });
  }
  if (pkg.pages.length === 0) throw new DocumentError(FORMAT, "empty", "the document has no pages");
  return pkg;
}
