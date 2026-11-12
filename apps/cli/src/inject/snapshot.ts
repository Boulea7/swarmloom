/**
 * Browser entry bundled as dist/snapshot.js (IIFE). The CLI injects it into a page, calls
 * `window.__swarmloomSnapshot.prescroll(document)`, freezes the page's animations and then calls
 * `window.__swarmloomSnapshot.snapshot(document, options)` to capture a Blueprint.
 */
import { prescroll, snapshot } from "@swarmloom/snapshot-dom";

(globalThis as unknown as Record<string, unknown>).__swarmloomSnapshot = { prescroll, snapshot };
