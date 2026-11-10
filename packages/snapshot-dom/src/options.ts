import type { BlueprintSource } from "@swarmloom/core";
import type { SnapshotOptions } from "./types";

export const DEFAULT_MAX_LAYERS = 6000;
export const DEFAULT_MAX_HEIGHT = 60000;

/** Snapshot options after validation, with defaults applied. */
export interface ResolvedOptions {
  origin: "document" | "element" | undefined;
  source: BlueprintSource | undefined;
  maxLayers: number;
  maxHeight: number;
  detectDuplicates: boolean;
  detectGuides: boolean;
  screenshot: { src: string; scrollX: number; scrollY: number; dpr: number } | undefined;
  prescroll: boolean;
  inlineImages: boolean;
  showFormValues: boolean;
  signal: AbortSignal | undefined;
}

function positive(name: string, value: unknown, fallback: number, integer: boolean): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new RangeError(
      `snapshot: ${name} must be a positive ${integer ? "integer" : "number"}, got ${String(value)}`,
    );
  }
  return value;
}

function flag(name: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`snapshot: ${name} must be a boolean`);
  return value;
}

/**
 * Validates caller-supplied options. Throws TypeError/RangeError with the offending option name;
 * these are programming errors, so they are not recoverable inside the snapshot.
 */
export function resolveOptions(opts: SnapshotOptions | undefined): ResolvedOptions {
  const o: SnapshotOptions = opts ?? {};
  if (typeof o !== "object") throw new TypeError("snapshot: options must be an object");
  if (o.origin !== undefined && o.origin !== "document" && o.origin !== "element") {
    throw new TypeError(`snapshot: origin must be "document" or "element", got ${String(o.origin)}`);
  }
  if (o.source !== undefined && (typeof o.source !== "object" || typeof o.source.type !== "string")) {
    throw new TypeError("snapshot: source must be an object with a string type");
  }
  const shot = o.screenshot;
  if (shot !== undefined) {
    const ok =
      typeof shot === "object" &&
      typeof shot.src === "string" &&
      shot.src.length > 0 &&
      Number.isFinite(shot.scrollX) &&
      Number.isFinite(shot.scrollY) &&
      Number.isFinite(shot.dpr) &&
      shot.dpr > 0;
    if (!ok) throw new TypeError("snapshot: screenshot needs { src, scrollX, scrollY, dpr > 0 }");
  }
  const signal = o.signal;
  if (signal !== undefined && (typeof signal !== "object" || typeof signal.aborted !== "boolean")) {
    throw new TypeError("snapshot: signal must be an AbortSignal");
  }
  return {
    origin: o.origin,
    source: o.source,
    maxLayers: positive("maxLayers", o.maxLayers, DEFAULT_MAX_LAYERS, true),
    maxHeight: positive("maxHeight", o.maxHeight, DEFAULT_MAX_HEIGHT, false),
    detectDuplicates: flag("detectDuplicates", o.detectDuplicates, true),
    detectGuides: flag("detectGuides", o.detectGuides, true),
    screenshot: shot,
    prescroll: flag("prescroll", o.prescroll, false),
    inlineImages: flag("inlineImages", o.inlineImages, false),
    showFormValues: flag("showFormValues", o.showFormValues, false),
    signal,
  };
}
