import { open, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect, formats } from "@swarmloom/formats";
import { errorMessage, RenderError, UsageError } from "../errors";
import type { StaticMount } from "../server/static";
import type { RenderInput } from "./protocol";

/** Largest input the CLI accepts (product limit for the CLI; adapters may apply lower ones). */
export const MAX_INPUT_BYTES = 500 * 1024 * 1024;
/** Text inputs up to this size travel as text; larger ones are served like binaries. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
/** Bytes read for format detection (container directories of ZIP/CFB files sit near the start). */
const DETECT_HEAD_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;
const FORMATS_HINT = 'Run "swarmloom formats" to list supported formats.';

/** Formats whose adapters take text when the content is valid UTF-8. */
const TEXT_FORMATS = new Set(["markdown", "html", "svg", "code"]);
const TEXT_EXTENSIONS = new Set([".csv", ".tsv"]);
const HTML_MIME = new Set(["text/html", "application/xhtml+xml"]);

/** Content of a file input: decoded text, a local file served to the page, or downloaded bytes. */
export type SourceContent = { text: string } | { path: string } | { bytes: Uint8Array };

/** What the render command feeds the render page. */
export type RenderSource =
  | {
      kind: "file";
      name: string;
      /** Adapter id from @swarmloom/formats. */
      format: string;
      content: SourceContent;
      /** Where a downloaded file came from (base for relative links and images). */
      origin?: string;
      /** Directory of a local file: its images, fonts and models are published next to the input. */
      dir?: string;
    }
  | {
      /** An HTML page from the web: captured live in the browser, its HTML kept as a fallback input. */
      kind: "page";
      name: string;
      url: string;
      html: string;
    };

/** True for http(s) URLs. */
export function isWebUrl(spec: string): boolean {
  return /^https?:\/\//i.test(spec);
}

/** True for URLs with a scheme other than file: (two letters minimum, so Windows drive letters are paths). */
export function isOtherUrl(spec: string): boolean {
  return /^[a-z][a-z0-9+.-]+:\/\//i.test(spec) && !/^file:/i.test(spec) && !isWebUrl(spec);
}

/**
 * Opens a local file or downloads a URL and identifies its format.
 *
 * @param spec File path, file: URL or http(s) URL.
 * @throws UsageError for missing files, unsupported schemes or formats, oversized inputs;
 *         RenderError when a download fails.
 */
export async function resolveSource(
  spec: string,
  opts: { cwd: string; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<RenderSource> {
  if (isWebUrl(spec)) return fetchSource(spec, opts.fetch ?? fetch, opts.signal);
  if (isOtherUrl(spec)) throw new UsageError(`Unsupported URL scheme in ${spec}`, "Use a file path or an http(s) URL.");
  return openFileSource(inputFilePath(spec, opts.cwd));
}

/** Absolute path of a local input given as a path or a file: URL (not for http(s) URLs). */
export function inputFilePath(spec: string, cwd: string): string {
  return /^file:/i.test(spec) ? fileURLToPath(spec) : path.resolve(cwd, spec);
}

async function openFileSource(file: string): Promise<RenderSource> {
  const info = await stat(file).catch(() => null);
  if (!info) throw new UsageError(`Input not found: ${file}`);
  if (!info.isFile()) throw new UsageError(`Input is not a file: ${file}`);
  if (info.size === 0) throw new UsageError(`Input is empty: ${file}`);
  if (info.size > MAX_INPUT_BYTES) {
    throw new UsageError(`Input is too large (${mib(info.size)}; the limit is ${mib(MAX_INPUT_BYTES)})`);
  }
  const name = path.basename(file);
  const head = await readHead(file, Math.min(info.size, DETECT_HEAD_BYTES));
  const format = await detectFormat(name, head);
  const dir = path.dirname(file);
  if (isTextual(name, format) && info.size <= MAX_TEXT_BYTES) {
    const bytes = info.size <= head.byteLength ? head : await readHead(file, info.size);
    const text = decodeUtf8(bytes);
    if (text !== null) return { kind: "file", name, format, content: { text }, dir };
  }
  return { kind: "file", name, format, content: { path: file }, dir };
}

async function readHead(file: string, length: number): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function detectFormat(name: string, bytes: Uint8Array, mime?: string): Promise<string> {
  const id = await detect({ name, bytes, type: mime }, formats);
  if (!id || id === "dom") throw new UsageError(`Unsupported input format: ${name}`, FORMATS_HINT);
  return id;
}

function isTextual(name: string, format: string): boolean {
  return TEXT_FORMATS.has(format) || TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * File name for a downloaded resource: the URL's last path segment, or one derived from its MIME type.
 * The server picks that segment (redirects included) and the CLI prints the name, so path separators,
 * characters Windows rejects and control characters (C0, DEL, C1: terminal escape sequences) become "_".
 */
export function nameForUrl(url: URL, mime: string | undefined): string {
  let last = "";
  try {
    last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    last = "";
  }
  last = last.replace(/[\\/:*?"<>|\p{Cc}]/gu, "_");
  if (path.extname(last)) return last;
  if (mime && HTML_MIME.has(mime)) return `${last || "index"}.html`;
  const ext = formats.find((f) => mime && f.mime.includes(mime))?.extensions[0];
  return ext ? `${last || "download"}.${ext}` : last || "index.html";
}

async function fetchSource(spec: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RenderSource> {
  let url: URL;
  try {
    url = new URL(spec);
  } catch {
    throw new UsageError(`Invalid URL: ${spec}`);
  }
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? anySignal([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: "follow", signal: combined });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RenderError(`Could not download ${spec}: ${errorMessage(error)}`);
  }
  if (!response.ok) throw new RenderError(`Could not download ${spec}: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_INPUT_BYTES) throw new UsageError(`${spec} is too large (${mib(declared)})`);
  const bytes = await readLimited(response, MAX_INPUT_BYTES, spec);
  if (bytes.byteLength === 0) throw new RenderError(`${spec} returned an empty body`);
  const finalUrl = new URL(response.url || url.href);
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const name = nameForUrl(finalUrl, mime);
  const format = await detectFormat(name, bytes, mime);
  if (format === "html" && (!mime || HTML_MIME.has(mime))) {
    return { kind: "page", name, url: finalUrl.href, html: new TextDecoder().decode(bytes) };
  }
  const text = isTextual(name, format) && bytes.byteLength <= MAX_TEXT_BYTES ? decodeUtf8(bytes) : null;
  const content: SourceContent = text !== null ? { text } : { bytes };
  return { kind: "file", name, format, content, origin: finalUrl.href };
}

async function readLimited(response: Response, limit: number, spec: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > limit) throw new UsageError(`${spec} is larger than ${mib(limit)}`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** AbortSignal.any for Node 20.0-20.2, which lack it. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (native) return native(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Files next to a local input the render page may load: images, fonts, style sheets, media and the
 * parts of multi-file 3D models. Documents, scripts and anything else in that directory stay private.
 */
const SIBLING_ASSETS = new Set([
  ".png",
  ".apng",
  ".jpg",
  ".jpeg",
  ".jfif",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".bmp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".css",
  ".mp4",
  ".webm",
  ".ogg",
  ".mp3",
  ".wav",
  ".gltf",
  ".glb",
  ".bin",
  ".ktx2",
]);

/** True for a file the input directory mount publishes (see {@link SIBLING_ASSETS}). */
export function isSiblingAsset(file: string): boolean {
  return SIBLING_ASSETS.has(path.extname(file).toLowerCase());
}

/**
 * URL path prefix the input is published under on the render page's own origin. `token` is a fresh
 * random value per render, so other local processes cannot guess the path while the server runs.
 */
export function inputBase(token: string): string {
  return `/input/${encodeURIComponent(token)}/`;
}

/**
 * Converts a source into the render page's input. Text travels inline; files and downloaded bytes are
 * referenced by a same-origin URL on the CLI's loopback server (see {@link servedInput}), so large
 * binaries never pass through the browser protocol as base64. Local text files also get that URL, as
 * the base for their relative images. `type` carries the detected adapter id so the page does not
 * have to guess again.
 *
 * @param inputUrl Absolute URL of {@link inputBase} on the render page server, ending with "/".
 */
export function toRenderInput(source: RenderSource, inputUrl: string): RenderInput {
  if (source.kind === "page") return { name: source.name, type: "html", url: source.url, text: source.html };
  const input: RenderInput = { name: source.name, type: source.format };
  const own = inputUrl + encodeURIComponent(source.name);
  if ("text" in source.content) {
    input.text = source.content.text;
    const base = source.origin ?? (source.dir ? own : undefined);
    if (base) input.url = base;
  } else {
    input.url = own;
  }
  return input;
}

/** What the render page server must publish for `source` under `base` (from {@link inputBase}). */
export function servedInput(
  source: RenderSource,
  base: string,
): { files: ReadonlyMap<string, string | Uint8Array>; mounts: StaticMount[] } {
  const files = new Map<string, string | Uint8Array>();
  const mounts: StaticMount[] = [];
  if (source.kind !== "file") return { files, mounts };
  if (!("text" in source.content)) {
    const body = "path" in source.content ? source.content.path : source.content.bytes;
    files.set(base + encodeURIComponent(source.name), body);
  }
  if (source.dir) mounts.push({ prefix: base, dir: source.dir, accept: isSiblingAsset });
  return { files, mounts };
}

/** Base name for default output files: the input file name without extension, or host + path for URLs. */
export function outputStem(spec: string): string {
  if (isWebUrl(spec)) {
    try {
      const url = new URL(spec);
      const last = url.pathname.split("/").filter(Boolean).pop();
      const stem = last ? `${url.hostname}-${last.replace(/\.[^.]*$/, "")}` : url.hostname;
      return stem.replace(/[^\w.-]+/g, "_") || "swarmloom";
    } catch {
      return "swarmloom";
    }
  }
  const file = /^file:/i.test(spec) ? fileURLToPath(spec) : spec;
  return path.basename(file).replace(/\.[^.]*$/, "") || "swarmloom";
}
