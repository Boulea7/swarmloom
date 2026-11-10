const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
/** Bytes of the head decoded for the JSON check. */
const TEXT_HEAD = 16 * 1024;

function startsWith(head: Uint8Array, sig: readonly number[]): boolean {
  return sig.every((b, i) => head[i] === b);
}

function ascii(head: Uint8Array, limit = head.length): string {
  let out = "";
  const n = Math.min(limit, head.length);
  for (let i = 0; i < n; i++) {
    const b = head[i] as number;
    out += b >= 32 && b < 127 ? String.fromCharCode(b) : " ";
  }
  return out;
}

/**
 * True when text looks like a Lottie (Bodymovin) document: a JSON object whose head has a
 * version string `"v"` and the timing keys `"fr"`, `"ip"` and `"op"`, plus `"layers"` or
 * `"assets"` (assets precede layers in exports with large embedded images).
 */
export function looksLikeLottieText(text: string): boolean {
  const head = text.slice(0, TEXT_HEAD);
  if (!/^﻿?\s*\{/.test(head)) return false;
  return (
    /"v"\s*:\s*"\d+\.\d+/.test(head) &&
    /"fr"\s*:/.test(head) &&
    /"ip"\s*:/.test(head) &&
    /"op"\s*:/.test(head) &&
    /"(?:layers|assets)"\s*:/.test(head)
  );
}

/**
 * True when bytes start a dotLottie archive: a ZIP whose first local entries include
 * `manifest.json` and an animation folder (`animations/` in v1, `a/` in v2).
 * Only the head is available, so this inspects the local file headers it contains.
 */
export function looksLikeDotLottie(head: Uint8Array): boolean {
  if (!startsWith(head, ZIP_LOCAL)) return false;
  const names: string[] = [];
  let at = 0;
  // Walk local file headers: signature, ..., name length @26, extra length @28, name @30.
  while (at + 30 <= head.length && startsWith(head.subarray(at), ZIP_LOCAL) && names.length < 64) {
    const view = new DataView(head.buffer, head.byteOffset + at);
    const flags = view.getUint16(6, true);
    const compressed = view.getUint32(18, true);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    const nameEnd = at + 30 + nameLen;
    if (nameEnd > head.length) break;
    names.push(ascii(head.subarray(at + 30, nameEnd)));
    // Sizes are unknown in the local header when a data descriptor follows (bit 3).
    if (flags & 0x08) break;
    at = nameEnd + extraLen + compressed;
  }
  const hasManifest = names.includes("manifest.json");
  const hasAnimation = names.some((n) => /^(?:animations|a)\/[^/]+\.json$/.test(n));
  if (hasManifest && hasAnimation) return true;
  // Fall back to the raw head for archives with data descriptors (names still appear in order).
  const raw = ascii(head);
  return raw.includes("manifest.json") && /(?:animations|\ba)\/[\w.-]+\.json/.test(raw);
}

/**
 * `Adapter.sniff` of the Lottie adapter: dotLottie archives and Lottie JSON (UTF-8).
 *
 * @param head First bytes of the input (formats passes 16 KiB).
 */
export function sniffLottie(head: Uint8Array, _name?: string): boolean {
  if (head.length < 4) return false;
  if (startsWith(head, ZIP_LOCAL)) return looksLikeDotLottie(head);
  // UTF-8 (with or without BOM); a cut-off multi-byte sequence at the end decodes to U+FFFD, which is fine here.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, TEXT_HEAD));
  return looksLikeLottieText(text);
}
