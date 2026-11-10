/** Base64 helpers that stay fast for multi-megabyte payloads (WAV soundtracks, input files). */

interface Base64Native {
  toBase64?: () => string;
}
interface Base64Ctor {
  fromBase64?: (s: string) => Uint8Array;
}

const CHUNK = 0x8000;

/** Encodes bytes as standard base64 (with padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as Base64Native).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Decodes standard base64 (whitespace tolerated).
 *
 * @throws TypeError when `text` is not valid base64.
 */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, "");
  try {
    const native = (Uint8Array as unknown as Base64Ctor).fromBase64;
    if (typeof native === "function") return native(clean);
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch (error) {
    throw new TypeError("Input is not valid base64", { cause: error });
  }
}
