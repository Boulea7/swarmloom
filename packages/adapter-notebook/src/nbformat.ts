/**
 * Jupyter notebook reader (nbformat 4). Validates the JSON shape and reduces cells and outputs to
 * the small model the layout needs. Unsupported cell types, output types and MIME bundles are
 * skipped and counted, never silently dropped.
 */

/** Thrown for inputs that are not a readable nbformat 4 notebook. */
export class NotebookError extends Error {
  override name = "NotebookError";
}

/** Raster image data (base64, whitespace removed). */
export interface ImageData {
  mime: ImageMime;
  data: string;
}

export type ImageMime = "image/png" | "image/jpeg" | "image/gif";

interface ResultBase {
  /** True for `execute_result` (shown with an `Out [n]` prompt). */
  result: boolean;
  /** Execution count of an `execute_result`. */
  count: number | null;
}

export interface StreamOutput {
  kind: "stream";
  name: "stdout" | "stderr";
  text: string;
}

export interface ErrorOutput {
  kind: "error";
  ename: string;
  evalue: string;
  /** Traceback lines joined with newlines (may contain ANSI escapes). */
  traceback: string;
}

export interface ImageOutput extends ResultBase, ImageData {
  kind: "image";
  /** Display size from the output metadata, CSS px. */
  width?: number;
  height?: number;
  /** The text/plain alternative, used as alt text. */
  alt: string;
}

export interface HtmlOutput extends ResultBase {
  kind: "html";
  /** Unsanitized HTML from the notebook. */
  html: string;
  /** The text/plain alternative, used when the HTML is too large. */
  plain: string;
}

export interface MarkdownOutput extends ResultBase {
  kind: "markdown";
  markdown: string;
}

export interface TextOutput extends ResultBase {
  kind: "text";
  text: string;
}

export type Output = StreamOutput | ErrorOutput | ImageOutput | HtmlOutput | MarkdownOutput | TextOutput;

export interface MarkdownCell {
  kind: "markdown";
  source: string;
  /** `attachment:<name>` images of the cell. */
  attachments: Record<string, ImageData>;
}

export interface CodeCell {
  kind: "code";
  source: string;
  count: number | null;
  outputs: Output[];
}

export interface RawCell {
  kind: "raw";
  source: string;
}

export type Cell = MarkdownCell | CodeCell | RawCell;

export interface Notebook {
  /** Kernel language, lower case ("python" when the metadata does not say). */
  language: string;
  /** `metadata.title` when present. */
  title?: string;
  cells: Cell[];
  /** Cells and outputs that are not drawn (limits, unsupported types). */
  dropped: number;
  /** Human-readable notes about what was simplified. */
  notes: string[];
}

export interface ParseOptions {
  /** Most cells kept. Default 500. */
  maxCells?: number;
  /** Most outputs kept per code cell. Default 24. */
  maxOutputs?: number;
  /** Largest base64 image kept, characters. Default 16 MiB. */
  maxImageChars?: number;
  /** Longest text kept per source or output, characters. Default 200 000. */
  maxTextChars?: number;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const IMAGE_MIMES: readonly ImageMime[] = ["image/png", "image/jpeg", "image/gif"];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** nbformat `multiline_string`: a string or a list of lines (each keeping its newline). */
function multiline(v: unknown, max: number): string | null {
  let s: string;
  if (typeof v === "string") s = v;
  else if (Array.isArray(v) && v.every((x) => typeof x === "string")) s = v.join("");
  else return null;
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}

function base64Of(v: unknown, max: number): string | null {
  const raw = multiline(v, max + 1024);
  if (raw === null) return null;
  const data = raw.replace(/\s+/g, "");
  if (data.length === 0 || data.length > max || data.length % 4 !== 0 || !BASE64.test(data)) return null;
  return data;
}

function countOf(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
}

function px(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 20_000 ? v : undefined;
}

class Reader {
  dropped = 0;
  readonly skipped = new Map<string, number>();
  constructor(readonly opts: Required<ParseOptions>) {}

  skip(what: string): null {
    this.dropped++;
    this.skipped.set(what, (this.skipped.get(what) ?? 0) + 1);
    return null;
  }

  text(v: unknown): string {
    return multiline(v, this.opts.maxTextChars) ?? "";
  }

  /** One entry of a display_data / execute_result MIME bundle, in a fixed preference order. */
  bundle(out: Json, result: boolean): Output | null {
    const data = isObj(out.data) ? out.data : {};
    const meta = isObj(out.metadata) ? out.metadata : {};
    const count = result ? countOf(out.execution_count) : null;
    const plain = multiline(data["text/plain"], this.opts.maxTextChars);
    const html = multiline(data["text/html"], this.opts.maxTextChars);
    const image = IMAGE_MIMES.find((m) => typeof data[m] === "string" || Array.isArray(data[m]));
    // HTML that needs a script to show anything (plots, widgets) loses to a static image.
    if (html !== null && !(image && /<script[\s>]/i.test(html))) {
      return { kind: "html", html, plain: plain ?? "", result, count };
    }
    if (image) {
      const b64 = base64Of(data[image], this.opts.maxImageChars);
      if (b64 === null) return this.skip(`${image} (invalid or too large)`);
      const m = isObj(meta[image]) ? meta[image] : {};
      const width = px(m.width);
      const height = px(m.height);
      return {
        kind: "image",
        mime: image,
        data: b64,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        alt: (plain ?? "").slice(0, 200),
        result,
        count,
      };
    }
    const md = multiline(data["text/markdown"], this.opts.maxTextChars);
    if (md !== null) return { kind: "markdown", markdown: md, result, count };
    const latex = multiline(data["text/latex"], this.opts.maxTextChars);
    if (plain !== null || latex !== null) return { kind: "text", text: plain ?? latex ?? "", result, count };
    const first = Object.keys(data)[0];
    return this.skip(first ? `${first} output` : "empty output");
  }

  output(out: unknown): Output | null {
    if (!isObj(out) || typeof out.output_type !== "string") return this.skip("malformed output");
    switch (out.output_type) {
      case "stream": {
        const name = out.name === "stderr" ? "stderr" : "stdout";
        return { kind: "stream", name, text: this.text(out.text) };
      }
      case "error": {
        const tb = Array.isArray(out.traceback) ? out.traceback.filter((l) => typeof l === "string") : [];
        const ename = typeof out.ename === "string" ? out.ename : "Error";
        const evalue = typeof out.evalue === "string" ? out.evalue : "";
        const traceback = tb.length > 0 ? tb.join("\n") : `${ename}: ${evalue}`;
        return { kind: "error", ename, evalue, traceback: traceback.slice(0, this.opts.maxTextChars) };
      }
      case "display_data":
        return this.bundle(out, false);
      case "execute_result":
        return this.bundle(out, true);
      default:
        return this.skip(`${out.output_type.slice(0, 40)} output`);
    }
  }

  attachments(v: unknown): Record<string, ImageData> {
    const out: Record<string, ImageData> = {};
    if (!isObj(v)) return out;
    for (const [name, bundle] of Object.entries(v)) {
      if (!isObj(bundle) || !/^[\w.\- ]{1,128}$/.test(name)) continue;
      const mime = IMAGE_MIMES.find((m) => m in bundle);
      const data = mime ? base64Of(bundle[mime], this.opts.maxImageChars) : null;
      if (mime && data) out[name] = { mime, data };
    }
    return out;
  }

  cell(c: unknown): Cell | null {
    if (!isObj(c) || typeof c.cell_type !== "string") return this.skip("malformed cell");
    const source = this.text(c.source).replace(/\r\n?/g, "\n");
    switch (c.cell_type) {
      case "markdown":
        return { kind: "markdown", source, attachments: this.attachments(c.attachments) };
      case "raw":
        return { kind: "raw", source };
      case "code": {
        const raw = Array.isArray(c.outputs) ? c.outputs : [];
        const outputs: Output[] = [];
        for (const o of raw) {
          if (outputs.length >= this.opts.maxOutputs) {
            this.skip("output beyond the per-cell limit");
            continue;
          }
          const out = this.output(o);
          if (out) outputs.push(out);
        }
        return { kind: "code", source, count: countOf(c.execution_count), outputs };
      }
      default:
        return this.skip(`${c.cell_type.slice(0, 40)} cell`);
    }
  }
}

function withDefaults(o: ParseOptions): Required<ParseOptions> {
  return {
    maxCells: Math.max(1, o.maxCells ?? 500),
    maxOutputs: Math.max(1, o.maxOutputs ?? 24),
    maxImageChars: Math.max(1024, o.maxImageChars ?? 16 * 1024 * 1024),
    maxTextChars: Math.max(1024, o.maxTextChars ?? 200_000),
  };
}

function languageOf(meta: Json): string {
  const ks = isObj(meta.kernelspec) ? meta.kernelspec : {};
  const li = isObj(meta.language_info) ? meta.language_info : {};
  const lang = typeof ks.language === "string" ? ks.language : typeof li.name === "string" ? li.name : "python";
  return lang.toLowerCase().slice(0, 40);
}

/** Parses and validates an nbformat 4 notebook. */
export function parseNotebook(text: string, options: ParseOptions = {}): Notebook {
  const opts = withDefaults(options);
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new NotebookError("notebook: the file is not valid JSON");
  }
  if (!isObj(doc)) throw new NotebookError("notebook: expected a JSON object");
  if (doc.nbformat === undefined) throw new NotebookError("notebook: not a Jupyter notebook (no nbformat field)");
  if (doc.nbformat !== 4) {
    throw new NotebookError(
      `notebook: nbformat ${String(doc.nbformat).slice(0, 8)} is not supported (open and save it with Jupyter to upgrade to nbformat 4)`,
    );
  }
  if (!Array.isArray(doc.cells)) throw new NotebookError("notebook: the cells list is missing");
  const reader = new Reader(opts);
  const cells: Cell[] = [];
  const notes: string[] = [];
  for (const c of doc.cells.slice(0, opts.maxCells)) {
    const cell = reader.cell(c);
    if (cell) cells.push(cell);
  }
  let dropped = reader.dropped;
  if (doc.cells.length > opts.maxCells) {
    const extra = doc.cells.length - opts.maxCells;
    dropped += extra;
    notes.push(`Only the first ${opts.maxCells} of ${doc.cells.length} cells are shown.`);
  }
  for (const [what, n] of reader.skipped) notes.push(`${n} × ${what} not drawn.`);
  const meta = isObj(doc.metadata) ? doc.metadata : {};
  const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : undefined;
  return { language: languageOf(meta), ...(title ? { title } : {}), cells, dropped, notes };
}

/**
 * Sniffs a notebook from its first bytes: a JSON object whose first key is one of the nbformat
 * top-level keys, with `cell_type` or `nbformat` in sight.
 */
export function looksLikeNotebook(head: Uint8Array | string): boolean {
  const text = typeof head === "string" ? head : new TextDecoder("utf-8").decode(head.subarray(0, 16 * 1024));
  return (
    /^﻿?\s*\{\s*"(?:cells|metadata|nbformat|nbformat_minor)"\s*:/.test(text) && /"(?:cell_type|nbformat)"\s*:/.test(text)
  );
}
