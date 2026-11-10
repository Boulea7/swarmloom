import type { Blueprint, BlueprintSource } from "@swarmloom/core";

/**
 * The part of the @swarmloom/snapshot-dom contract (contracts/snapshot.ts) the document adapters
 * use. Declared here so the adapters compile against the contract rather than one build of
 * snapshot-dom, and so tests can pass a stand-in.
 */
export interface SnapshotHtmlOptions {
  width: number;
  css?: string;
  document?: Document;
  baseUrl?: string;
  background?: string;
  scheme?: "light" | "dark";
  icon?: string;
  source?: BlueprintSource;
  maxLayers?: number;
  maxHeight?: number;
  detectDuplicates?: boolean;
  detectGuides?: boolean;
  signal?: AbortSignal;
}

/** `snapshotHtml` from @swarmloom/snapshot-dom. */
export type SnapshotHtml = (html: string, opts: SnapshotHtmlOptions) => Promise<Blueprint>;

let cached: Promise<SnapshotHtml> | undefined;

/** Imports @swarmloom/snapshot-dom on first use and checks that it provides `snapshotHtml`. */
export function loadSnapshotHtml(): Promise<SnapshotHtml> {
  cached ??= import("@swarmloom/snapshot-dom")
    .then((mod) => {
      const fn = (mod as { snapshotHtml?: unknown }).snapshotHtml;
      if (typeof fn !== "function") throw new Error("@swarmloom/snapshot-dom does not export snapshotHtml()");
      return fn as SnapshotHtml;
    })
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
