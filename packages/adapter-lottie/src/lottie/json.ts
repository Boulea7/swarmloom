import { LottieError } from "../errors";

/**
 * Maximum nesting depth of JSON text, found by one linear scan that skips string contents.
 * Runs before `JSON.parse`, so hostile nesting is rejected without building the object graph.
 */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 92 /* \ */) i++;
      else if (ch === 34 /* " */) inString = false;
      continue;
    }
    if (ch === 34) inString = true;
    else if (ch === 123 /* { */ || ch === 91 /* [ */) {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === 125 /* } */ || ch === 93 /* ] */) depth--;
  }
  return max;
}

/** Strips a UTF-8 byte order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses untrusted JSON with size and depth limits.
 *
 * @param what Noun used in error messages ("Lottie file", "manifest.json").
 * @throws LottieError "too-large" past the limits, "invalid" for malformed JSON.
 */
export function parseJson(text: string, limits: { maxBytes: number; maxDepth: number }, what: string): unknown {
  // UTF-16 length is a lower bound of the UTF-8 size; good enough for a guard.
  if (text.length > limits.maxBytes) {
    throw new LottieError("too-large", `The ${what} is larger than ${formatBytes(limits.maxBytes)}.`);
  }
  const clean = stripBom(text);
  const depth = jsonDepth(clean);
  if (depth > limits.maxDepth) {
    throw new LottieError("too-large", `The ${what} is nested ${depth} levels deep (the limit is ${limits.maxDepth}).`);
  }
  try {
    return JSON.parse(clean) as unknown;
  } catch (error) {
    throw new LottieError("invalid", `The ${what} is not valid JSON.`, { cause: error });
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MiB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KiB`;
  return `${n} bytes`;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
