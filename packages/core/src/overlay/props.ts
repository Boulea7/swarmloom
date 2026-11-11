import type { Rect } from "../types";

/** Overlay props as passed by choreographies: untrusted, read defensively without allocating. */
export type Props = Record<string, unknown>;

/** Finite number at `key`, else `fallback`. */
export function num(p: Props, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Non-empty string at `key`, else undefined. */
export function str(p: Props, key: string): string | undefined {
  const v = p[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function flag(p: Props, key: string, fallback: boolean): boolean {
  const v = p[key];
  return typeof v === "boolean" ? v : fallback;
}

export function isRect(v: unknown): v is Rect {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.w === "number" &&
    typeof r.h === "number" &&
    Number.isFinite(r.x + r.y + r.w + r.h)
  );
}

/** Array-like of numbers (number[] or a typed array such as SoundEngine.levels().bands). */
export function numbers(p: Props, key: string): ArrayLike<number> | undefined {
  const v = p[key];
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return v as ArrayLike<number>;
  return undefined;
}

/** Array of strings at `key` (colour lists), else undefined. */
export function strings(p: Props, key: string): readonly unknown[] | undefined {
  const v = p[key];
  return Array.isArray(v) && v.length > 0 ? v : undefined;
}
