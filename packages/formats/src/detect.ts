import type { SourceInput } from "@swarmloom/core";
import { findAscii, hasAscii, hasBytes, u32 } from "./bytes";
import { readCfb } from "./cfb";
import { type FormatEntry, formats } from "./registry";
import { classifyText } from "./text";
import { readZip, type ZipInfo } from "./zip";

/** Result of inspecting an input: the adapter id (if any) and whether the document is locked. */
export interface Inspection {
  id: string | null;
  /** Password-protected container (encrypted OOXML/ZIP, encrypted Word 97-2003 or PowerPoint). */
  encrypted: boolean;
}

/** Bytes handed to custom `sniff` hooks and decoded for text heuristics. */
const SNIFF_HEAD = 16384;

const ZIP_PARTS: readonly [string, string][] = [
  ["word/document.xml", "docx"],
  ["ppt/presentation.xml", "slides"],
  ["xl/workbook.xml", "sheet"],
];
const ZIP_FOLDERS: readonly [string, string][] = [
  ["word/", "docx"],
  ["ppt/", "slides"],
  ["xl/", "sheet"],
];
/** `mimetype` entry prefixes: ODS stays with the spreadsheet adapter, other OpenDocument types go to `odf`. */
const MIMETYPES: readonly [string, string][] = [
  ["application/vnd.oasis.opendocument.spreadsheet", "sheet"],
  ["application/vnd.oasis.opendocument.", "odf"],
  ["application/epub+zip", "epub"],
];
/** dotLottie animation entry: `animations/<id>.json` (v1) or `a/<id>.json` (v2), next to a root manifest.json. */
const DOTLOTTIE_ANIMATION = /^(?:animations|a)\/[^/]+\.json$/;
/** MIME types that say nothing about the content; detection ignores them. */
const WEAK_MIME = new Set(["", "text/plain", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

function extensionOf(input: SourceInput): string | null {
  let name = input.name;
  if (!name && input.url && !/^(?:data|blob):/i.test(input.url)) {
    try {
      name = decodeURIComponent(new URL(input.url, "http://x.invalid/").pathname);
    } catch {
      name = input.url;
    }
  }
  const base = name?.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() || null : null;
}

function byExtension(ext: string | null, registry: readonly FormatEntry[]): string | null {
  return ext ? (registry.find((f) => f.extensions.includes(ext))?.id ?? null) : null;
}

function mimeOf(type: string | undefined): string {
  return type?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function byMime(mime: string, registry: readonly FormatEntry[]): string | null {
  return WEAK_MIME.has(mime) ? null : (registry.find((f) => f.mime.includes(mime))?.id ?? null);
}

function zipFormat(zip: ZipInfo): string | null {
  for (const [part, id] of ZIP_PARTS) if (zip.names.includes(part)) return id;
  for (const [folder, id] of ZIP_FOLDERS) if (zip.names.some((n) => n.startsWith(folder))) return id;
  // Mirrors looksLikeDotLottie of @swarmloom/adapter-lottie.
  if (zip.names.includes("manifest.json") && zip.names.some((n) => DOTLOTTIE_ANIMATION.test(n))) return "lottie";
  const mimetype = zip.mimetype;
  if (mimetype) return MIMETYPES.find(([type]) => mimetype.startsWith(type))?.[1] ?? null;
  if (zip.names.includes("OFD.xml")) return "ofd";
  // XMind: content.json (XMind Zen) or content.xml (XMind 8) at the root, and no ODF mimetype entry.
  const xmind = zip.names.includes("content.json") || zip.names.includes("content.xml");
  return xmind && !zip.names.includes("mimetype") ? "mindmap" : null;
}

/** RTF: `{\rtf` after an optional UTF-8 BOM and a little whitespace. Also catches RTF saved as .doc. */
function isRtf(b: Uint8Array): boolean {
  let i = hasBytes(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < 64 && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return hasAscii(b, "{\\rtf", i);
}

function cfbFormat(names: readonly string[]): string | null {
  // Encrypted OOXML keeps the real package inside EncryptedPackage: only the file name can tell its type.
  if (names.includes("EncryptedPackage")) return null;
  if (names.includes("WordDocument")) return "doc";
  if (names.includes("Workbook") || names.includes("Book")) return "sheet";
  if (names.includes("PowerPoint Document")) return "slides";
  return null;
}

/** Signatures that identify a format on their own (no container parsing). */
function magicFormat(b: Uint8Array): string | null {
  if (findAscii(b, "%PDF-", 0, 1024) >= 0) return "pdf";
  if (isRtf(b)) return "rtf";
  if (hasAscii(b, "glTF") || hasAscii(b, "ply\n") || hasAscii(b, "ply\r\n")) return "three";
  // Binary STL: 80-byte header, triangle count, 50 bytes per triangle. The exact length is the signature.
  if (b.length > 84 && b.length === 84 + u32(b, 80) * 50) return "three";
  if (hasBytes(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  if (hasBytes(b, [0xff, 0xd8, 0xff])) return "image";
  if (hasAscii(b, "GIF87a") || hasAscii(b, "GIF89a")) return "image";
  if (hasAscii(b, "RIFF") && hasAscii(b, "WEBP", 8)) return "image";
  if (hasAscii(b, "ftyp", 4) && (hasAscii(b, "avif", 8) || hasAscii(b, "avis", 8))) return "image";
  if (hasAscii(b, "BM") && u32(b, 2) === b.length) return "image";
  return null;
}

/** Decodes the head of `bytes` as text, or returns undefined when it looks binary. */
function decodeText(bytes: Uint8Array): string | undefined {
  const head = bytes.subarray(0, SNIFF_HEAD);
  if (hasBytes(head, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(head);
  if (hasBytes(head, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(head);
  let control = 0;
  for (const byte of head) {
    if (byte === 0) return undefined;
    if (byte < 9 || (byte > 13 && byte < 32)) control++;
  }
  return control * 10 > head.length ? undefined : new TextDecoder().decode(head);
}

function inspectBytes(
  bytes: Uint8Array,
  name: string | undefined,
  ext: string | null,
  registry: readonly FormatEntry[],
): Inspection | null {
  if (hasBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) || hasBytes(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const zip = readZip(bytes);
    return { id: (zip && zipFormat(zip)) ?? byExtension(ext, registry), encrypted: zip?.encrypted ?? false };
  }
  const cfb = readCfb(bytes);
  if (cfb) return { id: cfbFormat(cfb.names) ?? byExtension(ext, registry), encrypted: cfb.encrypted };
  const magic = magicFormat(bytes);
  if (magic) return { id: magic, encrypted: false };
  const sniffed = sniff(bytes.subarray(0, SNIFF_HEAD), name, registry);
  return sniffed ? { id: sniffed, encrypted: false } : null;
}

/** Id of the first registry entry whose custom `sniff` hook accepts `head`, or null. */
function sniff(head: Uint8Array, name: string | undefined, registry: readonly FormatEntry[]): string | null {
  return registry.find((f) => f.sniff?.(head, name))?.id ?? null;
}

/**
 * Inspects an input: adapter id plus the encryption flag of document containers.
 *
 * Order, from most to least trustworthy:
 *  1. live element -> `dom`;
 *  2. containers: ZIP sub-type from entry names (word/, ppt/, xl/, the dotLottie manifest and
 *     animation, the ODF/EPUB mimetype entry, OFD.xml, XMind content) and CFB stream names
 *     (WordDocument, Workbook, PowerPoint Document), falling back to the extension for unknown or
 *     encrypted packages;
 *  3. magic bytes (PDF, RTF, glTF/GLB, PLY, binary STL, PNG, JPEG, GIF, WebP, AVIF, BMP), then
 *     custom `sniff` hooks of the registry (Lottie JSON); text inputs reach the hooks as the
 *     UTF-8 head, so decoded text and raw bytes of one file detect the same;
 *  4. file extension (name, else URL path), then MIME type (generic types such as text/plain and
 *     application/octet-stream are ignored);
 *  5. text heuristics on the decoded head (SVG/HTML prologs, notebooks, asciicasts, patches,
 *     FreeMind maps, glTF JSON, OBJ/STL, Lottie JSON, Markdown vs code vs CSV). Binary content
 *     never reaches this step.
 *
 * The result is restricted to ids present in `registry`.
 */
export function inspect(input: SourceInput, registry: readonly FormatEntry[] = formats): Inspection {
  const known = (id: string | null): string | null => (id && registry.some((f) => f.id === id) ? id : null);
  if (input.element) return { id: known("dom"), encrypted: false };
  const ext = extensionOf(input);
  const bytes = input.bytes && input.bytes.length > 0 ? input.bytes : undefined;
  const binary = bytes ? inspectBytes(bytes, input.name, ext, registry) : null;
  if (binary) return { id: known(binary.id), encrypted: binary.encrypted };
  if (!bytes && input.text) {
    const sniffed = sniff(new TextEncoder().encode(input.text.slice(0, SNIFF_HEAD)), input.name, registry);
    if (sniffed) return { id: sniffed, encrypted: false };
  }
  const named = byExtension(ext, registry) ?? byMime(mimeOf(input.type), registry);
  if (named) return { id: named, encrypted: false };
  const text = input.text ?? (bytes ? decodeText(bytes) : undefined);
  return { id: known(text === undefined ? null : classifyText(text)), encrypted: false };
}

/**
 * Detects the adapter id for an input, or `null` when nothing matches. See {@link inspect} for the
 * order of checks: binary signatures win over names because they cannot lie; names win over text
 * heuristics because text formats are ambiguous.
 *
 * @param input File bytes, text, URL, MIME type and/or live element.
 * @param registry Format list to resolve against. Default {@link formats}.
 */
export async function detect(input: SourceInput, registry: readonly FormatEntry[] = formats): Promise<string | null> {
  return inspect(input, registry).id;
}
