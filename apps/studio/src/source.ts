import type { SourceInput } from "@swarmloom/core";
import { inspect } from "@swarmloom/formats";
import { checkFormatLimit, MAX_INPUT_BYTES, StudioError } from "./errors";
import type { ExampleEntry } from "./examples/manifest";
import { formatById, formatOfName } from "./formats-meta";
import { normalizeSourceUrl, type SourceRef } from "./route";
import type { StudioServices } from "./services";
import type { StudioSettings } from "./settings";
import { decodeShare, ShareError } from "./share";

/** A source ready for `formats.load`, plus what the UI shows and shares about it. */
export interface OpenedSource {
  ref: SourceRef;
  input: SourceInput;
  /** File name (or URL basename) used for display, sharing and the CLI output name. */
  name: string;
  title: string;
  /** Adapter id when known before detection (examples, file extension). */
  format?: string;
  /** Full text of textual sources, which makes them shareable as a link. */
  text?: string;
  /** What to pass to `swarmloom render` to reproduce this build. */
  cliTarget: string;
  /** CLI target is a local file the user must have (pasted content, opened files). */
  cliNeedsFile: boolean;
  /** Example metadata, when the source is a bundled example. */
  example?: ExampleEntry;
  /** Settings carried by a share link. */
  settings?: Partial<StudioSettings>;
  /** Layout width the content was captured at (bookmarklet pages); defaults to the stage width. */
  layoutWidth?: number;
}

/** A local file or pasted text held in memory for the current session only. */
export interface LocalInput {
  name: string;
  type?: string;
  bytes?: Uint8Array;
  text?: string;
}

export interface ResolveContext {
  services: StudioServices;
  /** The local input opened in this session, for `file` and `launch` refs. */
  local: LocalInput | null;
  signal?: AbortSignal;
}

const DECODER = new TextDecoder("utf-8");

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function urlBaseName(url: string): string {
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return name || u.hostname;
  } catch {
    return url;
  }
}

/** Reads a response body with a hard byte limit, so a huge download cannot exhaust memory. */
export async function readLimited(response: Response, limit = MAX_INPUT_BYTES): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new StudioError("tooLarge", { size: declared });
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new StudioError("tooLarge", { size });
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function download(services: StudioServices, url: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await services.fetch(url, { signal, credentials: "omit", redirect: "follow" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new StudioError("fetch", { url }, { cause: error });
  }
  if (!response.ok) throw new StudioError("fetch", { url });
  return response;
}

/** Decodes bytes as text for textual formats (shareable, and cheaper for text adapters). */
function textOf(name: string, bytes: Uint8Array): string | undefined {
  if (!formatOfName(name)?.textual) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function fromLocal(ref: SourceRef, local: LocalInput): OpenedSource {
  const size = local.bytes?.byteLength ?? local.text?.length ?? 0;
  if (size > MAX_INPUT_BYTES) throw new StudioError("tooLarge", { size });
  if (size === 0) throw new StudioError("empty");
  const text = local.text ?? (local.bytes ? textOf(local.name, local.bytes) : undefined);
  const input: SourceInput = { name: local.name };
  if (local.type) input.type = local.type;
  if (text !== undefined) input.text = text;
  else if (local.bytes) input.bytes = local.bytes;
  return {
    ref,
    input,
    name: local.name,
    title: local.name,
    format: formatOfName(local.name)?.id,
    text,
    cliTarget: local.name,
    cliNeedsFile: true,
  };
}

async function fromExample(ref: { kind: "example"; id: string }, ctx: ResolveContext): Promise<OpenedSource> {
  const { services } = ctx;
  const entry = services.manifest.entries.find((e) => e.id === ref.id);
  if (!entry) throw new StudioError("example", { id: ref.id });
  const url = new URL(entry.path.split("/").map(encodeURIComponent).join("/"), services.examplesBase).href;
  const response = await download(services, url, ctx.signal);
  const bytes = await readLimited(response);
  const name = baseName(entry.path);
  const text = textOf(name, bytes);
  const input: SourceInput = { name, url };
  if (text !== undefined) input.text = text;
  else input.bytes = bytes;
  return {
    ref,
    input,
    name,
    title: entry.title,
    format: entry.format,
    text,
    cliTarget: url,
    cliNeedsFile: false,
    example: entry,
  };
}

async function fromUrl(ref: { kind: "url"; url: string }, ctx: ResolveContext): Promise<OpenedSource> {
  const response = await download(ctx.services, ref.url, ctx.signal);
  const bytes = await readLimited(response);
  if (bytes.byteLength === 0) throw new StudioError("empty");
  const name = urlBaseName(response.url || ref.url);
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() || undefined;
  const text = textOf(name, bytes) ?? (type?.startsWith("text/") ? DECODER.decode(bytes) : undefined);
  const input: SourceInput = { name, url: ref.url };
  if (type) input.type = type;
  if (text !== undefined) input.text = text;
  else input.bytes = bytes;
  return {
    ref,
    input,
    name,
    title: name,
    format: formatOfName(name)?.id,
    text,
    cliTarget: ref.url,
    cliNeedsFile: false,
  };
}

async function fromShared(ref: { kind: "shared"; payload: string }): Promise<OpenedSource> {
  let decoded: Awaited<ReturnType<typeof decodeShare>>;
  try {
    decoded = await decodeShare(ref.payload);
  } catch (error) {
    throw new StudioError("share", {}, { cause: error instanceof ShareError ? error : undefined });
  }
  return {
    ref,
    input: { name: decoded.name, text: decoded.text },
    name: decoded.name,
    title: decoded.name,
    format: formatOfName(decoded.name)?.id,
    text: decoded.text,
    cliTarget: decoded.name,
    cliNeedsFile: true,
    settings: decoded.settings,
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fromStored(ref: { kind: "stored"; key: string }, ctx: ResolveContext): Promise<OpenedSource> {
  const stored = await ctx.services.readStored?.(ref.key);
  if (!stored) throw new StudioError("inbox");
  const name = stored.name ? baseName(stored.name).slice(0, 200) : "input";
  if (stored.url !== undefined) {
    const url = normalizeSourceUrl(stored.url, location.href, { allowFileUrls: true });
    if (!url) throw new StudioError("url");
    const opened = await fromUrl({ kind: "url", url }, ctx);
    return { ...opened, ref, name: stored.name ? name : opened.name, title: stored.name ? name : opened.title };
  }
  let bytes: Uint8Array | undefined;
  try {
    bytes = stored.base64 !== undefined ? base64ToBytes(stored.base64) : undefined;
  } catch (error) {
    throw new StudioError("inbox", {}, { cause: error });
  }
  return fromLocal(ref, { name, type: stored.type, text: stored.text, bytes });
}

async function fromInbox(ref: { kind: "inbox"; id: string }, ctx: ResolveContext): Promise<OpenedSource> {
  const items = (await ctx.services.readInbox?.(ref.id)) ?? [];
  const file = items.find((i) => i.kind === "file");
  if (file?.kind === "file") {
    const bytes = new Uint8Array(await file.file.arrayBuffer());
    return fromLocal(ref, { name: file.file.name || "shared", type: file.file.type || undefined, bytes });
  }
  const link = items.find((i) => i.kind === "url");
  if (link?.kind === "url") {
    const url = normalizeSourceUrl(link.url, location.href);
    if (!url) throw new StudioError("url");
    return fromUrl({ kind: "url", url }, ctx);
  }
  const text = items.find((i) => i.kind === "text");
  if (text?.kind === "text") {
    // Apps often share a link as text.
    const url = normalizeSourceUrl(text.text, location.href);
    if (url && !/\s/.test(text.text.trim())) return fromUrl({ kind: "url", url }, ctx);
    return fromLocal(ref, { name: guessPasteName(text.text), text: text.text });
  }
  throw new StudioError("inbox");
}

/**
 * Text formats the registry's content heuristics recognise, with the extension a paste gets. The
 * name decides the adapter, so without this a pasted patch or notebook would open as Markdown.
 */
const SNIFFED_PASTE: Readonly<Record<string, string>> = {
  notebook: "ipynb",
  terminal: "cast",
  diff: "patch",
  mindmap: "mm",
  rtf: "rtf",
};

/**
 * Picks a file name for pasted text so the right adapter runs: SVG and HTML by their root
 * element; notebooks, asciicasts, patches, FreeMind maps and RTF by the registry's heuristics;
 * JSON and CSV by shape; Markdown otherwise.
 */
export function guessPasteName(text: string): string {
  const head = text.trimStart().slice(0, 2048);
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "pasted.svg";
  if (/^(<!--[\s\S]*?-->\s*)*(<!doctype html|<html[\s>]|<(body|div|section|main|article|header)[\s>])/i.test(head)) {
    return "pasted.html";
  }
  const sniffed = SNIFFED_PASTE[inspect({ text: text.trimStart() }).id ?? ""];
  if (sniffed) return `pasted.${sniffed}`;
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(text);
      return "pasted.json";
    } catch {
      // Not JSON; fall through.
    }
  }
  const lines = head
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 6);
  if (lines.length >= 2) {
    const commas = lines.map((l) => (l.match(/,/g) ?? []).length);
    const tabs = lines.map((l) => (l.match(/\t/g) ?? []).length);
    if (commas[0] && commas[0] > 0 && commas.every((c) => c === commas[0])) return "pasted.csv";
    if (tabs[0] && tabs[0] > 0 && tabs.every((c) => c === tabs[0])) return "pasted.tsv";
  }
  return "pasted.md";
}

async function fromHandoff(ref: { kind: "handoff" }, ctx: ResolveContext): Promise<OpenedSource> {
  const receive = ctx.services.receiveHandoff;
  if (!receive) throw new StudioError("handoff");
  const page = await receive(ctx.signal);
  const name = `${urlBaseName(page.url).replace(/\.[a-z0-9]+$/i, "") || "page"}.html`;
  return {
    ref,
    // The markup starts with a <base> pointing at the page; `url` is kept for adapters that want it.
    input: { name, type: "text/html", text: page.html, url: page.url },
    name,
    title: page.title || urlBaseName(page.url),
    format: "html",
    cliTarget: page.url,
    cliNeedsFile: false,
    layoutWidth: page.width,
  };
}

/** Resolves a source reference to loadable input. Throws {@link StudioError} for expected failures. */
export async function resolveSource(ref: SourceRef, ctx: ResolveContext): Promise<OpenedSource> {
  const opened = await resolveRef(ref, ctx);
  const { text, bytes } = opened.input;
  checkFormatLimit(typeof text === "string" ? text.length : (bytes?.byteLength ?? 0), opened.format);
  return opened;
}

async function resolveRef(ref: SourceRef, ctx: ResolveContext): Promise<OpenedSource> {
  switch (ref.kind) {
    case "example":
      return fromExample(ref, ctx);
    case "url":
      return fromUrl(ref, ctx);
    case "shared":
      return fromShared(ref);
    case "stored":
      return fromStored(ref, ctx);
    case "inbox":
      return fromInbox(ref, ctx);
    case "handoff":
      return fromHandoff(ref, ctx);
    case "launch":
    case "file":
      if (!ctx.local) throw new StudioError("file");
      return fromLocal(ref, ctx.local);
  }
}

/** Reads a picked or dropped file into a session-local input, rejecting oversized files early. */
export async function readLocalFile(file: File): Promise<LocalInput> {
  if (file.size > MAX_INPUT_BYTES) throw new StudioError("tooLarge", { size: file.size });
  if (file.size === 0) throw new StudioError("empty");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const local: LocalInput = { name: file.name || "file", bytes };
  if (file.type) local.type = file.type;
  return local;
}

/** Translated format label for a known adapter id. */
export function formatLabelKey(id: string | undefined): string {
  return id && formatById(id) ? `format.${id}` : "format.other";
}
