/**
 * Replacement for `@swarmloom/formats/src/registry.ts` in the IIFE build (swapped in by
 * vite.config.ts). Same exports, but adapters load from `swarm-loom.adapters.js` next to the
 * script instead of being bundled, so the global script stays small and every format stays lazy.
 */

import type { Adapter } from "@swarmloom/core";
import { createRegistry } from "@swarmloom/formats/meta";

export type { FormatEntry, FormatMeta } from "@swarmloom/formats/meta";

interface AdapterModule {
  loadAdapter(id: string): Promise<Adapter>;
}

/** URL of the running classic script, captured while it executes (currentScript is null later). */
const script = globalThis.document?.currentScript;
const scriptUrl = script instanceof HTMLScriptElement ? script.src : "";

let adapters: Promise<AdapterModule> | null = null;

function adapterModule(): Promise<AdapterModule> {
  if (!adapters) {
    const url = new URL(
      "swarm-loom.adapters.js",
      scriptUrl || globalThis.document?.baseURI || globalThis.location?.href,
    ).href;
    adapters = import(/* @vite-ignore */ url) as Promise<AdapterModule>;
    // Allow a retry after a network failure.
    adapters.catch(() => {
      adapters = null;
    });
  }
  return adapters;
}

/** CDN registry: same metadata as `@swarmloom/formats`, adapters fetched next to the script. */
export const formats = createRegistry(async (id) => (await adapterModule()).loadAdapter(id));
