/**
 * ESM entry of the CDN build (`dist/swarm-loom.adapters.js`). It carries the real format registry,
 * so every adapter stays a separate chunk under `dist/chunks/`, fetched the first time it is needed.
 */

import type { Adapter } from "@swarmloom/core";
import { formats } from "@swarmloom/formats";

/** Imports the adapter registered under `id`. */
export function loadAdapter(id: string): Promise<Adapter> {
  const entry = formats.find((f) => f.id === id);
  return entry ? entry.loader() : Promise.reject(new Error(`Unknown adapter "${id}"`));
}
