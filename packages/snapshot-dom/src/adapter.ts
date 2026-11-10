import type { Adapter, AdapterContext, BlueprintSource, LoadedSource, SourceInput } from "@swarmloom/core";
import { isDocument, isElement } from "./dom/env";
import { capture } from "./snapshot";
import type { SnapshotOptions } from "./types";

function rootOf(input: SourceInput): Element | Document {
  if (typeof input !== "object" || input === null)
    throw new TypeError("dom adapter: input must be a SourceInput object");
  const target: unknown = input.element;
  if (isDocument(target)) return target;
  if (typeof target === "object" && target !== null && isElement(target as Node)) return target as Element;
  throw new TypeError("dom adapter: SourceInput.element must be a connected Element or a Document");
}

/**
 * Adapter id "dom": captures `SourceInput.element` (or a Document passed there) as a Blueprint.
 * `<html>`/`<body>` and documents are captured as live pages (origin "document"), other elements
 * with their top-left at (0,0). `ctx.maxLayers` and `ctx.signal` are honoured.
 */
export const domAdapter: Adapter = {
  id: "dom",
  label: "Web page",
  extensions: [],
  mime: [],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    const root = rootOf(input);
    const opts: SnapshotOptions = {};
    if (ctx?.maxLayers !== undefined) opts.maxLayers = ctx.maxLayers;
    if (ctx?.signal !== undefined) opts.signal = ctx.signal;
    const name = typeof input.name === "string" && input.name ? input.name : undefined;
    if (name) {
      const source: BlueprintSource = { type: "dom", name };
      opts.source = source;
    }
    const blueprint = await capture(root, opts);
    if (name && !blueprint.source.title) {
      const doc = isDocument(root) ? root : root.ownerDocument;
      if (doc.title.trim()) blueprint.source.title = doc.title.trim();
    }
    return { blueprint };
  },
};
