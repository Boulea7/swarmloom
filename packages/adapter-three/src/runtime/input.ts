import type { AdapterContext, SourceInput } from "@swarmloom/core";
import { ThreeAdapterError, throwIfAborted } from "../errors";

/** Reads a response body with a hard byte limit (Content-Length is only a hint). */
async function readLimited(response: Response, maxBytes: number, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ThreeAdapterError("too-large", `This model is ${declared} bytes, more than the ${maxBytes} byte limit.`);
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ThreeAdapterError("too-large", `This model is larger than the ${maxBytes} byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Resolves the input bytes: `bytes`, else UTF-8 `text`, else a credential-free fetch of `url`. */
export async function readInput(input: SourceInput, ctx: AdapterContext, maxBytes: number): Promise<Uint8Array> {
  throwIfAborted(ctx.signal);
  let bytes: Uint8Array | undefined;
  if (input.bytes instanceof Uint8Array) bytes = input.bytes;
  else if (typeof input.text === "string") bytes = new TextEncoder().encode(input.text);
  else if (typeof input.url === "string" && input.url !== "") {
    let response: Response;
    try {
      response = await fetch(input.url, { credentials: "omit", signal: ctx.signal });
    } catch (error) {
      throwIfAborted(ctx.signal);
      throw new ThreeAdapterError("fetch-failed", `The model could not be downloaded from ${input.url}.`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new ThreeAdapterError("fetch-failed", `The model download failed with HTTP ${response.status}.`);
    }
    bytes = await readLimited(response, maxBytes, ctx.signal);
  }
  if (!bytes || bytes.byteLength === 0) throw new ThreeAdapterError("empty", "The 3D model file is empty.");
  if (bytes.byteLength > maxBytes) {
    throw new ThreeAdapterError(
      "too-large",
      `This model is ${bytes.byteLength} bytes, more than the ${maxBytes} byte limit.`,
    );
  }
  return bytes;
}

/** Name of the input without directories and query, for titles and format hints. */
export function inputName(input: SourceInput): string | undefined {
  const raw = input.name ?? input.url;
  if (!raw) return undefined;
  const path = raw.split(/[?#]/, 1)[0] ?? raw;
  return path.slice(path.lastIndexOf("/") + 1) || undefined;
}

/**
 * Stage size: the layout width, and either the configured height, the viewport height
 * (full-bleed stages) or a 16:10 box (embeds narrower than the viewport).
 */
export function stageSize(ctx: AdapterContext, height: number | undefined): { w: number; h: number } {
  if (!Number.isFinite(ctx.width) || ctx.width <= 0) {
    throw new TypeError(`AdapterContext.width must be a positive number, got ${String(ctx.width)}`);
  }
  const w = Math.round(Math.min(8192, Math.max(160, ctx.width)));
  if (height !== undefined) return { w, h: height };
  const view = ctx.document.defaultView;
  const vw = view?.innerWidth ?? 0;
  const vh = view?.innerHeight ?? 0;
  const fullBleed = vw > 0 && vh > 0 && w >= vw * 0.9;
  const h = fullBleed ? vh : w * 0.625;
  return { w, h: Math.round(Math.min(4096, Math.max(240, h))) };
}
