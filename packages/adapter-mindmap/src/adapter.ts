import type { Adapter, AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import { buildMindmapBlueprint } from "./layers";
import { createMeasure, layoutMindmap } from "./layout";
import {
  looksLikeFreemind,
  looksLikeXmind,
  MindmapError,
  type ParseOptions,
  parseFreemindText,
  parseMindmap,
} from "./parse";
import { baseName, checkContext } from "./source";

/** Default input size limit: 32 MiB. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export interface MindmapAdapterOptions extends ParseOptions {
  /** Reject larger inputs. Default {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number;
}

async function readBytes(input: SourceInput, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array | string> {
  const tooLarge = (n: number): Error => new RangeError(`mind map is too large (${n} bytes, limit ${maxBytes})`);
  if (input.bytes instanceof Uint8Array) {
    if (input.bytes.byteLength > maxBytes) throw tooLarge(input.bytes.byteLength);
    return input.bytes;
  }
  if (typeof input.text === "string") {
    if (input.text.length > maxBytes) throw tooLarge(input.text.length);
    return input.text;
  }
  if (typeof input.url === "string" && input.url) {
    const res = await fetch(input.url, { signal, credentials: "omit" });
    if (!res.ok) throw new Error(`Could not fetch the mind map (${res.status} ${res.statusText})`.trim());
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw tooLarge(declared);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge(bytes.byteLength);
    return bytes;
  }
  throw new TypeError("The mind map adapter needs bytes, text or a URL");
}

/**
 * Creates the mind map adapter: XMind (.xmind, Zen and XMind 8) and FreeMind/Freeplane (.mm).
 * The blueprint uses core layers only (boxes, texts, pen-drawn connectors), so no plugin is needed.
 */
export function createMindmapAdapter(options: MindmapAdapterOptions = {}): Adapter {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!(maxBytes > 0)) throw new RangeError("maxBytes must be positive");
  return {
    id: "mindmap",
    label: "Mind map",
    extensions: ["xmind", "mm"],
    mime: ["application/vnd.xmind.workbook", "application/x-freemind", "application/x-xmind"],
    sniff: (head) => looksLikeXmind(head) || looksLikeFreemind(new TextDecoder().decode(head.subarray(0, 4096))),
    async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
      checkContext(ctx, "mindmap");
      const data = await readBytes(input, maxBytes, ctx.signal);
      ctx.signal?.throwIfAborted();
      let map: ReturnType<typeof parseMindmap>;
      if (typeof data === "string") {
        if (!looksLikeFreemind(data))
          throw new MindmapError("mindmap: text input must be a FreeMind/Freeplane .mm document (.xmind needs bytes)");
        map = parseFreemindText(data, options);
      } else map = parseMindmap(data, options);
      const measure = createMeasure(ctx.document);
      const layout = layoutMindmap(map, Math.max(200, ctx.width - 80), measure);
      const name = baseName(input);
      const blueprint = buildMindmapBlueprint(map, layout, {
        theme: ctx.theme === "dark" ? "dark" : "light",
        width: ctx.width,
        ...(name ? { name } : {}),
        ...(ctx.maxLayers ? { maxLayers: ctx.maxLayers } : {}),
      });
      return { blueprint };
    },
  };
}

/** The mind map adapter with default options. */
export const mindmapAdapter: Adapter = createMindmapAdapter();
