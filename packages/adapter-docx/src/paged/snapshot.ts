import type { AdapterContext, Blueprint, BlueprintSource } from "@swarmloom/core";
import * as snapshotDom from "@swarmloom/snapshot-dom";
import { markPages, measurePages } from "./pages";
import type { Sandbox } from "./sandbox";
import { reparseContent, waitForAssets } from "./sandbox";
import { DESK, pageSheetStyle } from "./theme";

/** The subset of `SnapshotHtmlOptions` (contracts/snapshot.ts) these adapters pass. */
export interface SnapshotHtmlOptions {
  width: number;
  css?: string;
  document?: Document;
  background?: string;
  scheme?: "light" | "dark";
  icon?: string;
  source?: BlueprintSource;
  maxLayers?: number;
  signal?: AbortSignal;
}

/** `snapshotHtml` from @swarmloom/snapshot-dom (contracts/snapshot.ts). */
export type SnapshotHtmlFn = (html: string, opts: SnapshotHtmlOptions) => Promise<Blueprint>;

/**
 * The snapshot-dom implementation, resolved at call time. Accessed through the namespace so this package
 * builds against snapshot-dom stubs that do not export `snapshotHtml` yet.
 */
export function defaultSnapshotHtml(): SnapshotHtmlFn {
  const fn = (snapshotDom as unknown as { snapshotHtml?: SnapshotHtmlFn }).snapshotHtml;
  if (typeof fn !== "function") throw new Error("@swarmloom/snapshot-dom does not provide snapshotHtml()");
  return fn;
}

export interface SnapshotPagedOptions {
  sandbox: Sandbox;
  /** The sheet elements inside `sandbox.root`, in document order. */
  pages: Iterable<Element>;
  ctx: AdapterContext;
  source: BlueprintSource;
  icon?: string;
  snapshotHtml?: SnapshotHtmlFn;
}

/**
 * Snapshots laid-out paged content: rebuilds it from its HTML (see `reparseContent`), measures the
 * sheets in the sandbox, hands the same HTML and CSS to snapshot-dom at the same width, then marks the
 * sheets as page layers that contain their content. Element references into `sandbox.root` taken
 * before the call are stale afterwards.
 */
export async function snapshotPaged(opts: SnapshotPagedOptions): Promise<Blueprint> {
  const { sandbox, ctx } = opts;
  // Idempotent for content that was already rebuilt; guarantees measurement and snapshot agree.
  const pages = reparseContent(sandbox.root, opts.pages);
  await waitForAssets(sandbox.root);
  ctx.signal?.throwIfAborted();
  const sheets = measurePages(sandbox.root, pages);
  const css = sandbox.css();
  const snapshotHtml = opts.snapshotHtml ?? defaultSnapshotHtml();
  const blueprint = await snapshotHtml(sandbox.root.innerHTML, {
    width: sandbox.width,
    css,
    document: ctx.document,
    background: DESK[ctx.theme],
    scheme: "light",
    icon: opts.icon,
    source: opts.source,
    maxLayers: ctx.maxLayers,
    signal: ctx.signal,
  });
  blueprint.source = { ...opts.source, ...blueprint.source, type: opts.source.type };
  blueprint.background = DESK[ctx.theme];
  blueprint.scheme = "light";
  if (opts.icon && !blueprint.icon) blueprint.icon = opts.icon;
  return markPages(blueprint, sheets, pageSheetStyle(ctx.theme));
}
