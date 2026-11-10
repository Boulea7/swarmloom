import type { Blueprint, BlueprintSource } from "@swarmloom/core";

/**
 * The part of the @swarmloom/snapshot-dom contract (contracts/snapshot.ts) the text adapters use.
 * Declared here so adapters typecheck against the contract, not against whatever a given build of
 * snapshot-dom exports, and so tests can pass a stand-in.
 */
export interface SnapshotCommonOptions {
  origin?: "document" | "element";
  source?: BlueprintSource;
  maxLayers?: number;
  maxHeight?: number;
  detectDuplicates?: boolean;
  detectGuides?: boolean;
  prescroll?: boolean;
  inlineImages?: boolean;
  signal?: AbortSignal;
}

export interface SnapshotHtmlOptions extends SnapshotCommonOptions {
  width: number;
  css?: string;
  document?: Document;
  baseUrl?: string;
  background?: string;
  scheme?: "light" | "dark";
  icon?: string;
}

export interface SnapshotDom {
  snapshot(root: Element | Document, opts?: SnapshotCommonOptions): Promise<Blueprint>;
  snapshotHtml(html: string, opts: SnapshotHtmlOptions): Promise<Blueprint>;
}

let cached: Promise<SnapshotDom> | undefined;

/** Imports @swarmloom/snapshot-dom on first use and checks that it implements the contract. */
export function loadSnapshotDom(): Promise<SnapshotDom> {
  cached ??= import("@swarmloom/snapshot-dom")
    .then((mod) => {
      const m = mod as unknown as Partial<SnapshotDom>;
      if (typeof m.snapshot !== "function" || typeof m.snapshotHtml !== "function") {
        throw new Error("@swarmloom/snapshot-dom does not export snapshot() and snapshotHtml()");
      }
      return m as SnapshotDom;
    })
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
