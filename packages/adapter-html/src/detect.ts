import { decodeText } from "@swarmloom/adapter-code";

/** How far into the text the document checks look. */
const HEAD_CHARS = 4096;

/**
 * True when the HTML is a complete document (doctype, `<html>`, `<head>` or `<body>`), false for
 * a fragment such as `<section>...</section>`. Leading comments and whitespace are skipped.
 */
export function isFullDocument(html: string): boolean {
  const head = html
    .slice(0, HEAD_CHARS)
    .replace(/^﻿/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trimStart();
  if (/^<!doctype\s+html/i.test(head) || /^<\?xml\b/i.test(head)) return true;
  return /<(?:html|head|body)[\s>]/i.test(head);
}

/**
 * Finds `<meta charset="...">` or `<meta http-equiv="Content-Type" content="...; charset=...">`
 * in the first 1024 bytes, as the HTML encoding prescan does. Returns the label or undefined.
 */
export function sniffMetaCharset(bytes: Uint8Array): string | undefined {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  return m?.[1]?.toLowerCase();
}

/** Decodes HTML bytes: BOM, then the transport charset, then `<meta charset>`, then UTF-8 / windows-1252. */
export function decodeHtml(bytes: Uint8Array, charset?: string): string {
  return decodeText(bytes, charset ?? sniffMetaCharset(bytes));
}
