import { type AssetUrls, decodeBase64 } from "./kit/assets";
import { DocumentError } from "./kit/errors";
import { parseXml } from "./kit/xml";
import { resolvePath, ZipArchive } from "./kit/zip";
import { a, child, children, isOdf, NS } from "./ns";

/** Document classes this adapter renders. Drawings (ODG) use the presentation renderer. */
export type OdfKind = "text" | "spreadsheet" | "presentation";

/** An opened ODF document: its XML roots and access to embedded images. */
export interface OdfPackage {
  kind: OdfKind;
  /** True for single-file flat XML (.fodt/.fods/.fodp). */
  flat: boolean;
  /** `office:document-content`, or `office:document` for flat files. */
  content: Element;
  /** `office:document-styles` of styles.xml (zipped packages only). */
  styles?: Element;
  title?: string;
  /** Blob URL for a `draw:image` (package part or embedded base64), or null when unavailable. */
  image(el: Element): string | null;
  /** Number of images that could not be shown (missing, external or not an image). */
  readonly missingImages: number;
}

const FORMAT = "odf";
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGES = 96;

const KINDS: [RegExp, OdfKind][] = [
  [/^application\/vnd\.oasis\.opendocument\.text(?:-template|-master)?$/, "text"],
  [/^application\/vnd\.oasis\.opendocument\.spreadsheet(?:-template)?$/, "spreadsheet"],
  [/^application\/vnd\.oasis\.opendocument\.(?:presentation|graphics)(?:-template)?$/, "presentation"],
];

function kindOf(mime: string | undefined | null): OdfKind | undefined {
  return mime ? KINDS.find(([re]) => re.test(mime.trim()))?.[1] : undefined;
}

/** The body element of a kind (`office:text`, `office:spreadsheet`, `office:presentation`/`office:drawing`). */
export function bodyOf(pkg: OdfPackage): Element {
  const body = child(pkg.content, "office", "body");
  const names =
    pkg.kind === "text" ? ["text"] : pkg.kind === "spreadsheet" ? ["spreadsheet"] : ["presentation", "drawing"];
  for (const name of names) {
    const el = child(body, "office", name);
    if (el) return el;
  }
  throw new DocumentError(FORMAT, "malformed", `the document has no office:${names[0]} body`);
}

function titleOf(meta: Element | undefined): string | undefined {
  const m = child(meta, "office", "meta");
  const title = m ? Array.from(m.children).find((c) => c.localName === "title" && c.namespaceURI === NS.dc) : undefined;
  return title?.textContent?.trim() || undefined;
}

interface ImageSource {
  missing: number;
  count: number;
}

function limitImage(state: ImageSource, bytes: Uint8Array | null, assets: AssetUrls, key?: string): string | null {
  if (!bytes || bytes.length > MAX_IMAGE_BYTES || state.count >= MAX_IMAGES) {
    state.missing++;
    return null;
  }
  const url = assets.image(bytes, key);
  if (url) state.count++;
  else state.missing++;
  return url;
}

function openFlat(bytes: Uint8Array, win: Window, assets: AssetUrls): OdfPackage {
  const text = new TextDecoder().decode(bytes);
  const doc = parseXml(text, { format: FORMAT, part: "flat XML document", window: win });
  const root = doc.documentElement;
  if (!isOdf(root, "office", "document")) throw new DocumentError(FORMAT, "malformed", "not an OpenDocument file");
  const kind = kindOf(a(root, "office:mimetype"));
  if (!kind)
    throw new DocumentError(FORMAT, "unsupported", `unsupported document type "${a(root, "office:mimetype") ?? "?"}"`);
  const state: ImageSource = { missing: 0, count: 0 };
  return {
    kind,
    flat: true,
    content: root,
    title: titleOf(root),
    image(el) {
      const data = child(el, "office", "binary-data");
      return limitImage(state, data?.textContent ? decodeBase64(data.textContent) : null, assets);
    },
    get missingImages() {
      return state.missing;
    },
  };
}

function checkManifest(zip: ZipArchive, win: Window): string | undefined {
  if (!zip.has("META-INF/manifest.xml")) return undefined;
  const manifest = parseXml(zip.text("META-INF/manifest.xml"), { format: FORMAT, part: "manifest.xml", window: win });
  let rootType: string | undefined;
  for (const entry of children(manifest.documentElement, "manifest", "file-entry")) {
    if (child(entry, "manifest", "encryption-data")) {
      throw new DocumentError(FORMAT, "encrypted", "the document is password-protected");
    }
    if (a(entry, "manifest:full-path") === "/") rootType = a(entry, "manifest:media-type") ?? undefined;
  }
  return rootType;
}

function openZipped(bytes: Uint8Array, win: Window, assets: AssetUrls): OdfPackage {
  const zip = ZipArchive.open(bytes, FORMAT);
  const rootType = checkManifest(zip, win);
  const mimetype = zip.has("mimetype") ? zip.mimetype() : undefined;
  const kind = kindOf(mimetype) ?? kindOf(rootType);
  if (!kind)
    throw new DocumentError(FORMAT, "unsupported", `unsupported document type "${mimetype ?? rootType ?? "?"}"`);
  if (!zip.has("content.xml")) throw new DocumentError(FORMAT, "malformed", "the package has no content.xml");
  const part = (name: string) => parseXml(zip.text(name), { format: FORMAT, part: name, window: win }).documentElement;
  const content = part("content.xml");
  if (!isOdf(content, "office", "document-content"))
    throw new DocumentError(FORMAT, "malformed", "content.xml is not ODF content");
  const styles = zip.has("styles.xml") ? part("styles.xml") : undefined;
  const meta = zip.has("meta.xml") ? part("meta.xml") : undefined;
  const state: ImageSource = { missing: 0, count: 0 };
  const pkg: OdfPackage = {
    kind,
    flat: false,
    content,
    image(el) {
      const href = a(el, "xlink:href");
      const path = href ? resolvePath("", href) : null;
      if (!path || !zip.has(path)) {
        const inline = child(el, "office", "binary-data");
        return limitImage(state, inline?.textContent ? decodeBase64(inline.textContent) : null, assets);
      }
      const size = zip.size(path) ?? 0;
      return limitImage(state, size <= MAX_IMAGE_BYTES ? zip.read(path) : null, assets, path);
    },
    get missingImages() {
      return state.missing;
    },
  };
  if (styles) pkg.styles = styles;
  const title = titleOf(meta);
  if (title) pkg.title = title;
  return pkg;
}

/**
 * Opens an ODF package (ZIP) or flat XML document.
 *
 * @throws DocumentError `encrypted` for password-protected packages, `unsupported` for other ODF
 *   classes (formulas, charts, databases), `malformed` for broken containers or XML.
 */
export function openOdf(bytes: Uint8Array, win: Window, assets: AssetUrls): OdfPackage {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  return zip ? openZipped(bytes, win, assets) : openFlat(bytes, win, assets);
}
