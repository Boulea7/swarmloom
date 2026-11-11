/**
 * asciinema recordings: v2 and v3 asciicast files (a JSON header line followed by one JSON event
 * array per line) and the legacy v1 single JSON document.
 *
 * Format references: https://docs.asciinema.org/manual/asciicast/v2/ and
 * https://docs.asciinema.org/manual/asciicast/v3/ (v1 is the asciinema 1.x JSON document).
 */

import { type TerminalTheme, themeFrom } from "./ansi/palette";
import { MAX_COLS, MAX_ROWS } from "./screen";

/** Event codes: output, input, resize (`"COLSxROWS"`), marker, exit status (v3). */
export type CastCode = "o" | "i" | "r" | "m" | "x";

export interface CastEvent {
  /** Milliseconds since the start of the recording (monotonic). */
  t: number;
  code: CastCode;
  data: string;
}

export interface CastRecording {
  version: 1 | 2 | 3;
  cols: number;
  rows: number;
  title?: string;
  command?: string;
  /** `$SHELL` from the recorded environment. */
  shell?: string;
  /** Idle time limit chosen at recording time, ms. */
  idleTimeLimit?: number;
  /** Colours from the header, when the recorder captured them. */
  theme?: TerminalTheme;
  events: CastEvent[];
  /** Event lines that could not be parsed and were skipped. */
  skipped: number;
}

/** Error raised for input that is not a usable asciicast. */
export class CastError extends Error {
  override name = "CastError";
}

/** Most events read from one recording. */
export const MAX_EVENTS = 500_000;
/** Longest data string kept per event (characters). */
const MAX_EVENT_DATA = 1 << 20;
const CODES = new Set<string>(["o", "i", "r", "m", "x"]);

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown, max = 300): string | undefined {
  if (typeof v !== "string") return undefined;
  let out = "";
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  out = out.trim().slice(0, max);
  return out || undefined;
}

function dimension(v: unknown, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    throw new CastError(`asciicast: invalid terminal ${what}`);
  if (v > max) throw new CastError(`asciicast: terminal ${what} ${v} exceeds the limit of ${max}`);
  return v;
}

function seconds(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v * 1000 : undefined;
}

function headerFields(h: Json, cols: number, rows: number, version: 1 | 2 | 3, themeRaw: unknown): CastRecording {
  const env = isObject(h.env) ? h.env : {};
  const shell = text(env.SHELL);
  return {
    version,
    cols,
    rows,
    ...(text(h.title) ? { title: text(h.title) } : {}),
    ...(text(h.command) ? { command: text(h.command) } : {}),
    ...(shell ? { shell } : {}),
    ...(seconds(h.idle_time_limit) ? { idleTimeLimit: seconds(h.idle_time_limit) } : {}),
    ...(isObject(themeRaw) ? { theme: themeFrom(themeRaw) } : {}),
    events: [],
    skipped: 0,
  };
}

function parseV1(doc: Json): CastRecording {
  const rec = headerFields(
    doc,
    dimension(doc.width, MAX_COLS, "width"),
    dimension(doc.height, MAX_ROWS, "height"),
    1,
    null,
  );
  if (!Array.isArray(doc.stdout)) throw new CastError("asciicast v1: missing stdout frames");
  let t = 0;
  for (const frame of doc.stdout) {
    if (rec.events.length >= MAX_EVENTS) break;
    if (Array.isArray(frame) && typeof frame[0] === "number" && typeof frame[1] === "string" && frame[0] >= 0) {
      t += frame[0] * 1000;
      rec.events.push({ t, code: "o", data: frame[1].slice(0, MAX_EVENT_DATA) });
    } else rec.skipped++;
  }
  return rec;
}

function parseHeader(h: unknown): CastRecording {
  if (!isObject(h)) throw new CastError("asciicast: the header is not a JSON object");
  if (h.version === 2) {
    return headerFields(h, dimension(h.width, MAX_COLS, "width"), dimension(h.height, MAX_ROWS, "height"), 2, h.theme);
  }
  if (h.version === 3) {
    const term = isObject(h.term) ? h.term : {};
    return headerFields(
      h,
      dimension(term.cols, MAX_COLS, "cols"),
      dimension(term.rows, MAX_ROWS, "rows"),
      3,
      term.theme,
    );
  }
  throw new CastError(`asciicast: unsupported version ${JSON.stringify(h.version ?? null)} (expected 2 or 3)`);
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Parses an asciicast. Times become absolute, monotonic milliseconds (v3 intervals are summed,
 * out-of-order v2 times are clamped). Malformed event lines are skipped and counted; more than
 * half of the lines being malformed is an error.
 *
 * @throws CastError for a missing or invalid header, unsupported versions or oversized terminals.
 */
export function parseCast(source: string): CastRecording {
  const body = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i] as string).trim() === "") i++;
  if (i >= lines.length) throw new CastError("asciicast: the file is empty");
  const header = tryJson(lines[i] as string);
  if (header === undefined || (isObject(header) && header.version === 1)) {
    // Legacy v1 recordings are one (possibly pretty-printed) JSON document.
    const doc = tryJson(body);
    if (isObject(doc) && doc.version === 1) return parseV1(doc);
    throw new CastError("asciicast: the first line is not a JSON header");
  }
  const rec = parseHeader(header);
  let last = 0;
  let seen = 0;
  for (i++; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === "" || line.startsWith("#")) continue;
    seen++;
    if (rec.events.length >= MAX_EVENTS) {
      rec.skipped++;
      continue;
    }
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      rec.skipped++;
      continue;
    }
    if (
      !Array.isArray(ev) ||
      typeof ev[0] !== "number" ||
      !Number.isFinite(ev[0]) ||
      ev[0] < 0 ||
      typeof ev[1] !== "string" ||
      !CODES.has(ev[1]) ||
      typeof ev[2] !== "string"
    ) {
      rec.skipped++;
      continue;
    }
    const ms = ev[0] * 1000;
    const t = rec.version === 3 ? last + ms : Math.max(last, ms);
    last = t;
    rec.events.push({ t, code: ev[1] as CastCode, data: ev[2].slice(0, MAX_EVENT_DATA) });
  }
  if (seen > 0 && rec.skipped * 2 > seen) {
    throw new CastError(`asciicast: ${rec.skipped} of ${seen} event lines are malformed`);
  }
  return rec;
}

/**
 * True when `head` (the first bytes of a file) starts with an asciicast v2/v3 header line:
 * a JSON object with `"version": 2` and `width`, or `"version": 3` and `term`.
 */
export function looksLikeCast(head: Uint8Array): boolean {
  const start = new TextDecoder()
    .decode(head.subarray(0, 2048))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (!start.startsWith("{")) return false;
  const firstLine = start.split("\n", 1)[0] as string;
  const v2 = /"version"\s*:\s*2\b/.test(firstLine) && /"width"\s*:/.test(firstLine);
  const v3 = /"version"\s*:\s*3\b/.test(firstLine) && /"term"\s*:/.test(firstLine);
  return v2 || v3;
}
