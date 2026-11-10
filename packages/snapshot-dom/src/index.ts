import type {
  Adapter,
  AdapterContext,
  Blueprint,
  BlueprintSource,
  LoadedSource,
  Size,
  SourceInput,
} from "@swarmloom/core";

export interface SnapshotOptions {
  /** Upper bound on emitted layers; `Blueprint.truncated` is set when it is hit. Default 6000. */
  maxLayers?: number;
  /** Content below this many px (from the root's top) is dropped and reported. Default 60000. */
  maxHeight?: number;
  /** Viewport recorded in `Blueprint.viewport`. Default: the window size. */
  viewport?: Size;
  /** Copied into `Blueprint.source`. Default `{ type: "dom" }` plus the document title and URL. */
  source?: BlueprintSource;
  signal?: AbortSignal;
}

/**
 * Captures a live DOM tree as a {@link Blueprint}.
 *
 * Walks `root` in paint order and emits box, text, path, image, media and guide layers in stage
 * coordinates (origin at the root's top-left), with `parent`/`master`/`snaps` dependencies.
 * Layout reads are batched; nothing in the page is mutated.
 *
 * @param root A document (whole page) or any element subtree.
 * @param opts Limits, viewport and source metadata.
 * @throws Error "not implemented yet" until the snapshotter lands.
 */
export async function snapshot(root: Element | Document, opts?: SnapshotOptions): Promise<Blueprint> {
  void root;
  void opts;
  throw new Error("not implemented yet");
}

/** Adapter for live DOM input (`SourceInput.element`): the extension and `<swarm-loom>` use it. */
export const domAdapter: Adapter = {
  id: "dom",
  label: "Web page",
  extensions: [],
  mime: [],
  async load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource> {
    if (!input.element) throw new TypeError("dom adapter needs SourceInput.element");
    const blueprint = await snapshot(input.element, { maxLayers: ctx.maxLayers, signal: ctx.signal });
    return { blueprint };
  },
};
