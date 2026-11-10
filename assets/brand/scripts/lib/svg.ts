/** Formats a coordinate compactly: at most 2 decimals, no trailing zeros, no leading zero, no "-0". */
export function n(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`non-finite SVG number: ${value}`);
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  return String(rounded).replace(/^(-?)0\./, "$1.");
}

/** Escapes text for use inside SVG/XML text nodes and attribute values. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Attribute map; `undefined` and `false` values are omitted, `true` renders as a bare name="" pair. */
export type Attrs = Record<string, string | number | boolean | undefined>;

/** Serialises attributes in insertion order. Numbers are formatted with {@link n}. */
export function attrs(map: Attrs): string {
  let out = "";
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined || value === false) continue;
    const text = value === true ? "" : typeof value === "number" ? n(value) : esc(value);
    out += ` ${key}="${text}"`;
  }
  return out;
}

/** Builds an element; with no children it self-closes. Children are raw (already serialised) markup. */
export function el(tag: string, map: Attrs = {}, ...children: string[]): string {
  const inner = children.join("");
  return inner ? `<${tag}${attrs(map)}>${inner}</${tag}>` : `<${tag}${attrs(map)}/>`;
}

/** Options for {@link svgDoc}. */
export interface SvgDocOptions {
  width: number;
  height: number;
  /** Accessible name; adds role="img", aria-label and a <title>. */
  title?: string;
  /** Raw CSS placed in a <style> element. */
  style?: string;
  /** Emit width/height attributes (default true). Set false for fluid embeds. */
  intrinsicSize?: boolean;
  /** Display size when it differs from the viewBox size (e.g. a 32-unit icon shown at 512 px). */
  display?: { width: number; height: number };
}

/** Wraps a body into a standalone SVG document with a viewBox and optional accessible title. */
export function svgDoc(body: string, opts: SvgDocOptions): string {
  const { width, height, title, style } = opts;
  if (!(width > 0 && height > 0)) throw new Error(`invalid SVG size ${width}x${height}`);
  const sized = opts.intrinsicSize !== false;
  const open = `<svg${attrs({
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${n(width)} ${n(height)}`,
    width: sized ? (opts.display?.width ?? width) : undefined,
    height: sized ? (opts.display?.height ?? height) : undefined,
    role: title ? "img" : undefined,
    "aria-label": title,
    // Shapes without an explicit fill stay invisible instead of rendering as black blobs.
    fill: "none",
  })}>`;
  const head = (title ? `<title>${esc(title)}</title>` : "") + (style ? `<style>${style}</style>` : "");
  return `${open}${head}${body}</svg>\n`;
}

/** 2D point. */
export interface Pt {
  x: number;
  y: number;
}

/** Shorthand for a point. */
export const pt = (x: number, y: number): Pt => ({ x, y });

/** Translates every absolute coordinate pair in a path made only of M/L/Q/C/Z commands. */
export function translatePath(d: string, dx: number, dy: number, scale = 1): string {
  return d.replace(/([MLQCZ])([^MLQCZ]*)/g, (_m, cmd: string, args: string) => {
    if (cmd === "Z") return "Z";
    const nums = args
      .trim()
      .split(/[\s,]+|(?=-)/)
      .filter(Boolean)
      .map(Number);
    if (nums.length % 2 !== 0 || nums.some((v) => !Number.isFinite(v)))
      throw new Error(`bad path segment ${cmd}${args}`);
    const out: string[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      out.push(`${n((nums[i] ?? 0) * scale + dx)} ${n((nums[i + 1] ?? 0) * scale + dy)}`);
    }
    return cmd + out.join(" ");
  });
}
