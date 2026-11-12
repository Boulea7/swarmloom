import type { Blueprint } from "@swarmloom/core";

/** Reads the bytes behind a blob: URL; rejects when it is gone. */
export type BlobReader = (url: string) => Promise<ArrayBuffer>;

/** blob: URLs as they appear inside the blueprint JSON (attribute values, CSS url(...)). */
const BLOB_URL = /blob:[^"'()\s\\]+/g;

const readBlob: BlobReader = async (url) => (await fetch(url)).arrayBuffer();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Directory the driver served the input from ("http://127.0.0.1:port/input/token/"), or "" when the
 * input is not on the render page's own origin. A remote input URL is part of what was played.
 */
function servedDir(inputUrl: string | undefined, pageOrigin: string | undefined): string {
  if (!inputUrl || !pageOrigin) return "";
  try {
    const dir = new URL(".", inputUrl);
    return dir.origin === pageOrigin ? dir.href : "";
  } catch {
    return "";
  }
}

/** The render page's own origin plus "/" when it is http(s) (the driver's loopback server), else "". */
function pageRoot(pageOrigin: string | undefined): string {
  return pageOrigin && /^https?:\/\//i.test(pageOrigin) ? `${pageOrigin}/` : "";
}

/**
 * SHA-256 (hex) of the blueprint's JSON with the addresses that change from run to run replaced:
 * the directory the driver served the input from (a random path on a random port, on the render
 * page's origin) becomes "input:/", every blob: URL becomes "blob:sha256-" plus the hash of its
 * bytes ("blob:gone-n", numbered by first use, when it cannot be read), and any other address on the
 * render page's origin, such as a footnote link resolved against the page, starts with "page:/".
 * Remote URLs stay. The same input then hashes the same in every run.
 *
 * @param pageOrigin Origin of the render page; only addresses on this origin are normalized.
 * @returns "" when the page has no Web Crypto (not a secure context).
 */
export async function blueprintSha256(
  blueprint: Blueprint,
  inputUrl: string | undefined,
  pageOrigin: string | undefined,
  read: BlobReader = readBlob,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  let json = JSON.stringify(blueprint);
  const base = servedDir(inputUrl, pageOrigin);
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
  // After the blob: URLs, which embed the same origin and are read by their full address.
  const root = pageRoot(pageOrigin);
  if (root) json = json.split(root).join("page:/");
  return hex(await subtle.digest("SHA-256", new TextEncoder().encode(json)));
}
