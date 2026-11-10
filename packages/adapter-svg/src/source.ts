import type { SourceInput } from "@swarmloom/core";

/** Decodes SVG bytes honouring a BOM or the XML declaration's encoding (UTF-8 otherwise). */
export function decodeSvgBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const head = String.fromCharCode(...bytes.subarray(0, 200));
  const label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/.exec(head)?.[1];
  if (label) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: fall through to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * True when `head` (the first bytes of a file) looks like an SVG document: optional BOM, XML
 * declaration, comments and doctype, then an `<svg` start tag.
 */
export function looksLikeSvg(head: Uint8Array): boolean {
  let text = decodeSvgBytes(head.subarray(0, 4096));
  text = text.replace(/^﻿/, "");
  for (let guard = 0; guard < 32; guard++) {
    text = text.trimStart();
    const skip = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>)/i.exec(text);
    if (!skip) break;
    text = text.slice(skip[0].length);
  }
  return /^<svg[\s>/:]/i.test(text) || /^<[\w-]+:svg[\s>]/i.test(text);
}

/**
 * Reads the SVG text of a source input: `text`, `bytes`, a serialised `<svg>` element, or a
 * fetched `url`. Rejects inputs larger than `maxBytes`.
 */
export async function readSvgText(input: SourceInput, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const tooLarge = (n: number): Error =>
    new RangeError(`SVG is too large (${n} bytes, limit ${maxBytes}); simplify or split the file`);
  if (typeof input.text === "string") {
    if (input.text.length > maxBytes) throw tooLarge(input.text.length);
    return input.text;
  }
  if (input.bytes instanceof Uint8Array) {
    if (input.bytes.byteLength > maxBytes) throw tooLarge(input.bytes.byteLength);
    return decodeSvgBytes(input.bytes);
  }
  if (input.element) {
    if (input.element.localName !== "svg") throw new TypeError("The SVG adapter accepts only <svg> elements");
    const text = new XMLSerializer().serializeToString(input.element);
    if (text.length > maxBytes) throw tooLarge(text.length);
    return text;
  }
  if (typeof input.url === "string" && input.url) {
    const res = await fetch(input.url, { signal });
    if (!res.ok) throw new Error(`Could not fetch the SVG (${res.status} ${res.statusText})`.trim());
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw tooLarge(declared);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge(bytes.byteLength);
    return decodeSvgBytes(bytes);
  }
  throw new TypeError("The SVG adapter needs text, bytes, an <svg> element or a URL");
}
