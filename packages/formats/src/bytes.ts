/** Small bounds-checked readers over untrusted byte arrays. Out-of-range reads return -1 instead of throwing. */

/** Unsigned 16-bit little-endian value at `at`, or -1 when out of range. */
export function u16(bytes: Uint8Array, at: number): number {
  if (at < 0 || at + 2 > bytes.length) return -1;
  return bytes[at] | (bytes[at + 1] << 8);
}

/** Unsigned 32-bit little-endian value at `at`, or -1 when out of range. */
export function u32(bytes: Uint8Array, at: number): number {
  if (at < 0 || at + 4 > bytes.length) return -1;
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/** Unsigned 64-bit little-endian value at `at` when it fits in a safe integer, else -1. */
export function u64(bytes: Uint8Array, at: number): number {
  const lo = u32(bytes, at);
  const hi = u32(bytes, at + 4);
  if (lo < 0 || hi < 0 || hi > 0x1fffff) return -1;
  return hi * 0x100000000 + lo;
}

/** True when `bytes` contains the ASCII string `sig` at `offset`. */
export function hasAscii(bytes: Uint8Array, sig: string, offset = 0): boolean {
  if (offset < 0 || bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig.charCodeAt(i)) return false;
  return true;
}

/** True when `bytes` starts with the byte sequence `sig` at `offset`. */
export function hasBytes(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

/** First index of the ASCII string `sig` within `bytes[from, to)`, or -1. */
export function findAscii(bytes: Uint8Array, sig: string, from = 0, to = bytes.length): number {
  const first = sig.charCodeAt(0);
  const end = Math.min(bytes.length, to) - sig.length;
  for (let i = Math.max(0, from); i <= end; i++) {
    if (bytes[i] === first && hasAscii(bytes, sig, i)) return i;
  }
  return -1;
}

/** Decodes `bytes[start, end)` as UTF-16LE (CFB directory names). */
export function utf16le(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i + 1 < end; i += 2) out += String.fromCharCode(u16(bytes, i));
  return out;
}
