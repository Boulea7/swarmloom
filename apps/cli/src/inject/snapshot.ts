/**
 * Browser entry bundled as dist/snapshot.js (IIFE). The CLI injects it into a page and calls
 * `window.__swarmloomSnapshot.snapshot(document, options)` to capture a Blueprint.
 */
import { snapshot } from "@swarmloom/snapshot-dom";

(globalThis as unknown as Record<string, unknown>).__swarmloomSnapshot = { snapshot };
