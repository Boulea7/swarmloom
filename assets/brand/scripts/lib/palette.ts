import { readFileSync } from "node:fs";
import { BRAND_DIR } from "./paths.ts";

/** A named cursor colour; the order of `Palette.cursors` is the order agents are assigned colours. */
export interface CursorColor {
  name: string;
  hex: string;
}

/** Brand palette as stored in assets/brand/palette.json (the single source of truth). */
export interface Palette {
  name: string;
  nameZh: string;
  tagline: { zh: string; en: string };
  primary: string;
  accent: string;
  select: string;
  cursors: CursorColor[];
  neutrals: { ink: string; paper: string; lineLight: string; lineDark: string };
  mark: {
    tileFrom: string;
    tileTo: string;
    tileFromDark: string;
    tileToDark: string;
    weft: string;
    warp: string;
    cursor: string;
  };
  nameTag: { radius: number; fontSize: number; fontWeight: number; text: string; highlight: string };
}

const HEX = /^#[0-9A-F]{6}$/;
const RGBA = /^rgba\(\d{1,3},\d{1,3},\d{1,3},(0|1|0?\.\d+)\)$/;

function fail(path: string, expected: string): never {
  throw new Error(`palette.json: ${path} must be ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) fail(`${path}.${key}`, "a non-empty string");
  return value;
}

function color(obj: Record<string, unknown>, key: string, path: string): string {
  const value = str(obj, key, path);
  if (!HEX.test(value) && !RGBA.test(value)) fail(`${path}.${key}`, "#RRGGBB (uppercase) or compact rgba(r,g,b,a)");
  return value;
}

function num(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${path}.${key}`, "a positive number");
  return value;
}

function record(obj: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const value = obj[key];
  if (!isRecord(value)) fail(`${path}.${key}`, "an object");
  return value;
}

/** Validates untrusted JSON and returns a typed palette; throws with the offending path on error. */
export function parsePalette(input: unknown): Palette {
  if (!isRecord(input)) fail("$", "an object");
  const tagline = record(input, "tagline", "$");
  const neutrals = record(input, "neutrals", "$");
  const mark = record(input, "mark", "$");
  const tag = record(input, "nameTag", "$");
  const cursorsRaw = input.cursors;
  if (!Array.isArray(cursorsRaw) || cursorsRaw.length < 8) fail("$.cursors", "an array of at least 8 colours");
  const cursors = cursorsRaw.map((entry: unknown, i): CursorColor => {
    if (!isRecord(entry)) fail(`$.cursors[${i}]`, "an object");
    return { name: str(entry, "name", `$.cursors[${i}]`), hex: color(entry, "hex", `$.cursors[${i}]`) };
  });
  return {
    name: str(input, "name", "$"),
    nameZh: str(input, "nameZh", "$"),
    tagline: { zh: str(tagline, "zh", "$.tagline"), en: str(tagline, "en", "$.tagline") },
    primary: color(input, "primary", "$"),
    accent: color(input, "accent", "$"),
    select: color(input, "select", "$"),
    cursors,
    neutrals: {
      ink: color(neutrals, "ink", "$.neutrals"),
      paper: color(neutrals, "paper", "$.neutrals"),
      lineLight: color(neutrals, "lineLight", "$.neutrals"),
      lineDark: color(neutrals, "lineDark", "$.neutrals"),
    },
    mark: {
      tileFrom: color(mark, "tileFrom", "$.mark"),
      tileTo: color(mark, "tileTo", "$.mark"),
      tileFromDark: color(mark, "tileFromDark", "$.mark"),
      tileToDark: color(mark, "tileToDark", "$.mark"),
      weft: color(mark, "weft", "$.mark"),
      warp: color(mark, "warp", "$.mark"),
      cursor: color(mark, "cursor", "$.mark"),
    },
    nameTag: {
      radius: num(tag, "radius", "$.nameTag"),
      fontSize: num(tag, "fontSize", "$.nameTag"),
      fontWeight: num(tag, "fontWeight", "$.nameTag"),
      text: color(tag, "text", "$.nameTag"),
      highlight: color(tag, "highlight", "$.nameTag"),
    },
  };
}

/** Reads and validates assets/brand/palette.json. */
export function loadPalette(file = `${BRAND_DIR}/palette.json`): Palette {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`palette.json: cannot read ${file}: ${(error as Error).message}`);
  }
  return parsePalette(raw);
}

/** Cursor colour for agent index `i`, cycling through the palette in order. */
export function cursorColor(palette: Palette, i: number): string {
  const list = palette.cursors;
  const entry = list[((i % list.length) + list.length) % list.length];
  if (!entry) throw new Error("palette has no cursor colours");
  return entry.hex;
}
