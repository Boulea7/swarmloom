import type { SourceInput } from "@swarmloom/core";
import { type FormatEntry, formats } from "./registry";

const SNIFF_HEAD = 4096;
const ZIP_SCAN = 1 << 20;

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function utf16le(s: string): number[] {
  return Array.from(s).flatMap((c) => [c.charCodeAt(0), 0]);
}

function indexOf(bytes: Uint8Array, sig: readonly number[], limit = bytes.length): number {
  const end = Math.min(bytes.length, limit) - sig.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
    return i;
  }
  return -1;
}

function extensionOf(input: SourceInput): string | null {
  let name = input.name;
  if (!name && input.url) {
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
  if (!ext) return null;
  return registry.find((f) => f.extensions.includes(ext))?.id ?? null;
}

function byMime(type: string | undefined, registry: readonly FormatEntry[]): string | null {
  const mime = type?.split(";")[0]?.trim().toLowerCase();
  if (!mime) return null;
  return registry.find((f) => f.mime.includes(mime))?.id ?? null;
}

/** OOXML/ODF containers: decide by extension first, then by well-known part names. */
function zipFormat(bytes: Uint8Array, ext: string | null, registry: readonly FormatEntry[]): string | null {
  const known = byExtension(ext, registry);
  if (known) return known;
  if (indexOf(bytes, ascii("word/"), ZIP_SCAN) >= 0) return "docx";
  if (indexOf(bytes, ascii("ppt/"), ZIP_SCAN) >= 0) return "slides";
  if (indexOf(bytes, ascii("xl/"), ZIP_SCAN) >= 0) return "sheet";
  if (indexOf(bytes, ascii("application/vnd.oasis.opendocument.presentation"), 256) >= 0) return "slides";
  if (indexOf(bytes, ascii("application/vnd.oasis.opendocument.spreadsheet"), 256) >= 0) return "sheet";
  return null;
}

/** Compound File Binary (legacy Office): decide by extension, then by stream names in the directory. */
function cfbFormat(bytes: Uint8Array, ext: string | null, registry: readonly FormatEntry[]): string | null {
  const known = byExtension(ext, registry);
  if (known) return known;
  if (indexOf(bytes, utf16le("WordDocument")) >= 0) return "doc";
  if (indexOf(bytes, utf16le("Workbook")) >= 0) return "sheet";
  if (indexOf(bytes, utf16le("PowerPoint Document")) >= 0) return "slides";
  return null;
}

function magicFormat(bytes: Uint8Array, ext: string | null, registry: readonly FormatEntry[]): string | null {
  if (indexOf(bytes, ascii("%PDF-"), 1024) >= 0) return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return zipFormat(bytes, ext, registry);
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return cfbFormat(bytes, ext, registry);
  if (startsWith(bytes, ascii("glTF"))) return "three";
  if (startsWith(bytes, ascii("ply\n")) || startsWith(bytes, ascii("ply\r\n"))) return "three";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image";
  if (startsWith(bytes, ascii("ftypavif"), 4)) return "image";
  return null;
}

const SVG_RE = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype svg[^>]*>\s*)?<svg[\s>]/i;
const HTML_RE = /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype html|<html[\s>])/i;

function textFormat(text: string): string | null {
  const head = text.slice(0, SNIFF_HEAD).replace(/^\uFEFF/, "");
  if (SVG_RE.test(head)) return "svg";
  if (HTML_RE.test(head)) return "html";
  return null;
}

/**
 * Detects the adapter id for an input, or null when nothing matches.
 *
 * Order: live element (`dom`) -> magic bytes (PDF, ZIP-based Office, CFB legacy Office, GLB, PLY,
 * PNG/JPEG/GIF/WEBP/AVIF) -> custom `sniff` hooks -> file extension (name or URL path) -> MIME type
 * -> text sniffing (`<svg`, HTML doctype). Binary signatures win over names because they cannot lie;
 * names win over text sniffing because text formats are ambiguous.
 */
export async function detect(input: SourceInput, registry: readonly FormatEntry[] = formats): Promise<string | null> {
  if (input.element) return "dom";
  const ext = extensionOf(input);
  if (input.bytes) {
    const magic = magicFormat(input.bytes, ext, registry);
    if (magic) return magic;
    const head = input.bytes.subarray(0, SNIFF_HEAD);
    const sniffed = registry.find((f) => f.sniff?.(head, input.name));
    if (sniffed) return sniffed.id;
  }
  const named = byExtension(ext, registry) ?? byMime(input.type, registry);
  if (named) return named;
  const text = input.text ?? (input.bytes ? new TextDecoder().decode(input.bytes.subarray(0, SNIFF_HEAD)) : undefined);
  return text ? textFormat(text) : null;
}
