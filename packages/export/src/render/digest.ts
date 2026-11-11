import type { Blueprint } from "@swarmloom/core";

/** Reads the bytes behind a blob: URL; rejects when it is gone. */
export type BlobReader = (url: string) => Promise<ArrayBuffer>;

/** blob: URLs as they appear inside the blueprint JSON (attribute values, CSS url(...)). */
const BLOB_URL = /blob:[^"'()\s\\]+/g;

const readBlob: BlobReader = async (url) => (await fetch(url)).arrayBuffer();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Directory part of an http(s) input URL ("http://host/input/token/"), or "" when there is none. */
function inputBase(inputUrl: string | undefined): string {
  if (!inputUrl || !/^https?:\/\//i.test(inputUrl)) return "";
  const slash = inputUrl.lastIndexOf("/");
  return slash > inputUrl.indexOf("//") + 1 ? inputUrl.slice(0, slash + 1) : "";
}

/**
 * SHA-256 (hex) of the blueprint's JSON with the addresses that change from run to run replaced:
 * the directory the input was served from (the CLI uses a random path on a random port) becomes
 * "input:/", and every blob: URL becomes "blob:sha256-" plus the hash of its bytes ("blob:gone-n",
 * numbered by first use, when it cannot be read). The same input then hashes the same in every run.
 *
 * @returns "" when the page has no Web Crypto (not a secure context).
 */
export async function blueprintSha256(
  blueprint: Blueprint,
  inputUrl: string | undefined,
  read: BlobReader = readBlob,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  let json = JSON.stringify(blueprint);
  const base = inputBase(inputUrl);
  if (base) json = json.split(base).join("input:/");
  const names = new Map<string, string>();
  for (const url of new Set(json.match(BLOB_URL))) {
    try {
      names.set(url, `blob:sha256-${hex(await subtle.digest("SHA-256", await read(url)))}`);
    } catch {
      names.set(url, `blob:gone-${names.size}`);
    }
  }
  if (names.size) json = json.replace(BLOB_URL, (url) => names.get(url) ?? url);
  return hex(await subtle.digest("SHA-256", new TextEncoder().encode(json)));
}
