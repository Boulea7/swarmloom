/**
 * The extension's `?key=` handoff: the extension stores an input in its storage and opens the
 * bundled Studio with the key, and Studio reads that entry once and removes it.
 */
import type { StoredInput } from "./services";

interface ExtensionStorageArea {
  get(keys: string): Promise<Record<string, unknown>>;
  remove(keys: string): Promise<void>;
}

interface StorageNamespace {
  storage?: { session?: ExtensionStorageArea; local?: ExtensionStorageArea };
}

interface NamespaceHolder {
  browser?: StorageNamespace;
  chrome?: StorageNamespace;
}

/**
 * Storage areas to search, session first. Firefox and Safari keep the promise-based API on
 * `browser` (Firefox's `chrome.storage` takes callbacks and returns undefined), Chromium on
 * `chrome`, so `browser` wins when it has storage, as in the extension's own API shim.
 */
function extensionStorage(scope: NamespaceHolder): ExtensionStorageArea[] {
  const storage = scope.browser?.storage ?? scope.chrome?.storage;
  return [storage?.session, storage?.local].filter((a): a is ExtensionStorageArea => Boolean(a));
}

/** Validates what the extension stored under a handoff key: a name plus exactly one payload. */
function storedInput(value: unknown): StoredInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  const out: StoredInput = { name: str(v.name)?.slice(0, 200) ?? "input" };
  const type = str(v.type);
  if (type) out.type = type.slice(0, 200);
  const payloads = ["url", "text", "base64"].filter((k) => typeof v[k] === "string");
  if (payloads.length !== 1) return null;
  if (typeof v.url === "string") out.url = v.url;
  if (typeof v.text === "string") out.text = v.text;
  if (typeof v.base64 === "string") out.base64 = v.base64;
  return out;
}

/** Reads and removes a handoff entry from extension storage (session first, then local). */
export async function readStored(
  key: string,
  scope: NamespaceHolder = globalThis as NamespaceHolder,
): Promise<StoredInput | null> {
  for (const area of extensionStorage(scope)) {
    const record = await area.get(key);
    if (!record || !(key in record)) continue;
    await area.remove(key).catch(() => undefined);
    return storedInput(record[key]);
  }
  return null;
}
