import type { AdapterContext, LoadedSource, SourceInput } from "@swarmloom/core";
import { detect } from "./detect";
import { type FormatEntry, formats } from "./registry";

export { detect } from "./detect";
export { type FormatEntry, formats } from "./registry";

function defaultContext(): AdapterContext {
  const doc = globalThis.document;
  if (!doc) throw new Error("load() needs ctx.document outside a browser");
  const dark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return { document: doc, width: doc.documentElement.clientWidth || 1280, theme: dark ? "dark" : "light" };
}

/**
 * Detects the format of `input`, imports the matching adapter and loads it.
 *
 * @param input File bytes, text, URL or live element.
 * @param ctx Layout context; defaults to the current document, its width and the preferred colour scheme.
 * @param registry Format list to resolve against. Default {@link formats}.
 * @throws Error when the format is unknown, or whatever the adapter throws.
 */
export async function load(
  input: SourceInput,
  ctx?: AdapterContext,
  registry: readonly FormatEntry[] = formats,
): Promise<LoadedSource> {
  const id = await detect(input, registry);
  const entry = id ? registry.find((f) => f.id === id) : undefined;
  if (!entry) throw new Error(`Unsupported input: ${input.name ?? input.url ?? input.type ?? "unknown"}`);
  const adapter = await entry.loader();
  return adapter.load(input, ctx ?? defaultContext());
}
