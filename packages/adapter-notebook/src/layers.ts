/**
 * Notebook -> Blueprint. One column of cells under a prompt gutter. A code cell is a frame (box),
 * its highlighted source (text, typed), a run indicator (custom layer, see plugin.ts) and its
 * outputs, chained by `parent` so a cell is always built frame -> code -> run -> outputs.
 * Markdown cells are one typed text layer each.
 */

import { ansiToHtml, escapeHtml, LOOM_INK, LOOM_PAPER, stripAnsi } from "@swarmloom/adapter-terminal/ansi";
import type { Blueprint, BoxLayer, CSSMap, CustomLayer, ImageLayer, Layer, TextLayer } from "@swarmloom/core";
import { highlightCode } from "./highlight";
import { imageSize } from "./images";
import { markdownToHtml, soleHeading } from "./markdown";
import { createMeasurer, type Measurer, type MeasureStyle } from "./measure";
import type { Cell, CodeCell, ImageData, ImageOutput, Notebook, Output } from "./nbformat";
import { RUN_TASK, type RunData } from "./plugin";
import { htmlText, resolveAttachments, sanitizeHtml } from "./sanitize";
import {
  CODE_FONT_PX,
  CODE_LINE_PX,
  MD_FONT_PX,
  MONO_FONT,
  type NotebookPalette,
  notebookCss,
  notebookPalette,
  OUT_LINE_PX,
} from "./theme";

export interface NotebookLayoutOptions {
  document: Document;
  /** Stage width, px (the column is at most 1040 px wide and centred). */
  width: number;
  theme: "light" | "dark";
  name?: string;
  /** Most layers emitted; whole cells are dropped beyond it. Default 4000. */
  maxLayers?: number;
  /** "color" (default) keeps ANSI colours in streams and tracebacks; "strip" removes them. */
  ansi?: "color" | "strip";
  /** Longest text output shown, lines. Default 300. */
  maxOutputLines?: number;
  /** Tallest output shown, px; taller outputs are clipped. Default 1600. */
  maxOutputHeight?: number;
}

const CELL_GAP = 16;
const OUT_GAP = 4;
const PAD_X = 14;
const CODE_PAD_Y = 10;
const OUT_PAD_Y = 6;
const PROMPT_H = 20;
/** Text longer than this fades in instead of being typed. */
const MAX_TYPED = 4000;
/** HTML outputs longer than this fall back to their text/plain form. */
const MAX_HTML = 300_000;
const HEADING_EM: Record<number, number> = { 1: 1.9, 2: 1.45, 3: 1.2, 4: 1.05, 5: 1, 6: 1 };

const mono = (fontPx: number, linePx: number, extra: CSSMap = {}): CSSMap => ({
  "font-family": MONO_FONT,
  "font-size": `${fontPx}px`,
  "line-height": `${linePx}px`,
  "white-space": "pre-wrap",
  "overflow-wrap": "anywhere",
  "tab-size": "4",
  "box-sizing": "border-box",
  ...extra,
});

interface Geometry {
  stageW: number;
  margin: number;
  promptX: number;
  promptW: number;
  cellX: number;
  cellW: number;
  compact: boolean;
}

function geometry(width: number): Geometry {
  const stageW = Math.max(320, Math.round(width));
  const pageW = Math.min(stageW, 1040);
  const pageX = Math.round((stageW - pageW) / 2);
  const compact = pageW < 640;
  const margin = compact ? 14 : 32;
  const gutter = compact ? 46 : 84;
  return {
    stageW,
    margin,
    promptX: pageX + margin,
    promptW: gutter - 6,
    cellX: pageX + margin + gutter,
    cellW: pageW - 2 * margin - gutter,
    compact,
  };
}

class Builder {
  readonly layers: Layer[] = [];
  readonly notes: string[] = [];
  dropped = 0;
  clipped = 0;
  usesRun = false;
  y: number;
  readonly maxLines: number;
  readonly maxOutH: number;

  constructor(
    readonly nb: Notebook,
    readonly g: Geometry,
    readonly pal: NotebookPalette,
    readonly measure: Measurer,
    readonly opts: NotebookLayoutOptions,
  ) {
    this.y = g.margin;
    this.maxLines = Math.max(1, opts.maxOutputLines ?? 300);
    this.maxOutH = Math.max(80, opts.maxOutputHeight ?? 1600);
  }

  get doc(): Document {
    return this.opts.document;
  }

  codeStyle(): MeasureStyle {
    return {
      css: mono(CODE_FONT_PX, CODE_LINE_PX, { padding: `${CODE_PAD_Y}px ${PAD_X}px`, color: this.pal.ink }),
      fontPx: CODE_FONT_PX,
      linePx: CODE_LINE_PX,
      charEm: 0.6,
      padY: CODE_PAD_Y,
      padX: PAD_X,
    };
  }

  markdown(source: string): string {
    const html = markdownToHtml(source, { highlight: (code, lang) => highlightCode(code, lang, this.pal) });
    return sanitizeHtml(html, this.doc);
  }

  /** Static `In [ ]:` / `Out [n]:` label in the gutter. */
  promptLabel(id: string, parent: string, y: number, text: string, color: string, priority: number): TextLayer {
    return {
      id,
      kind: "text",
      role: "label",
      parent,
      box: { x: this.g.promptX, y, w: this.g.promptW, h: PROMPT_H },
      z: 2,
      priority,
      text,
      html: escapeHtml(text),
      style: {
        "font-family": MONO_FONT,
        "font-size": "12px",
        "font-weight": "600",
        "line-height": `${PROMPT_H}px`,
        color,
        "text-align": "right",
        "white-space": "pre",
        "padding-right": "6px",
        "box-sizing": "border-box",
      },
      reveal: "fade",
    };
  }

  markdownCell(i: number, source: string, attachments: Record<string, ImageData>): void {
    if (!source.trim()) return;
    const resolved = resolveAttachments(source, attachments);
    const html = `<div class="slnb-md">${this.markdown(resolved)}</div>`;
    const style: MeasureStyle = {
      css: { "box-sizing": "border-box", padding: "2px 0" },
      fontPx: MD_FONT_PX,
      linePx: MD_FONT_PX * 1.6,
      charEm: 0.55,
      padY: 2,
      padX: 0,
    };
    const { cellX, cellW } = this.g;
    const h = Math.max(24, this.measure.height(html, cellW, style));
    const depth = soleHeading(source);
    const text = htmlText(html, this.doc);
    this.layers.push({
      id: `nb-${i}-md`,
      kind: "text",
      role: depth ? "heading" : "paragraph",
      box: { x: cellX, y: this.y, w: cellW, h },
      z: 1,
      priority: i * 1000,
      text,
      html,
      style: style.css,
      fontSize: depth ? Math.round(MD_FONT_PX * (HEADING_EM[depth] ?? 1) * 10) / 10 : MD_FONT_PX,
      reveal: text.length > MAX_TYPED ? "fade" : "type",
      meta: { cell: i, cellType: "markdown" },
    });
    this.y += h + CELL_GAP;
  }

  /** Frame and source text of a code or raw cell; returns the id the next layer hangs from. */
  sourceBlock(i: number, source: string, raw: boolean): string {
    const { cellX, cellW } = this.g;
    const code = source.replace(/\n+$/, "");
    const html = raw ? escapeHtml(code) : highlightCode(code, this.nb.language, this.pal);
    const style = this.codeStyle();
    const h = Math.max(CODE_LINE_PX + 2 * CODE_PAD_Y, this.measure.height(html || " ", cellW, style));
    const box = { x: cellX, y: this.y, w: cellW, h };
    const frame: BoxLayer = {
      id: `nb-${i}-frame`,
      kind: "box",
      role: "section",
      box,
      z: 0,
      priority: i * 1000,
      style: {
        "background-color": this.pal.cell,
        border: `1px ${raw ? "dashed" : "solid"} ${this.pal.border}`,
        "border-radius": "8px",
      },
      meta: { cell: i, cellType: raw ? "raw" : "code" },
    };
    this.layers.push(frame);
    let last = frame.id;
    if (code.trim()) {
      this.layers.push({
        id: `nb-${i}-code`,
        kind: "text",
        role: "code",
        parent: frame.id,
        box,
        z: 1,
        priority: i * 1000 + 1,
        text: code,
        html,
        style: style.css,
        fontSize: CODE_FONT_PX,
        reveal: code.length > MAX_TYPED ? "fade" : "type",
        meta: { cell: i, language: raw ? "raw" : this.nb.language },
      });
      last = `nb-${i}-code`;
    }
    this.y += h;
    return last;
  }

  codeCell(i: number, cell: CodeCell): void {
    const frameY = this.y;
    const parent = this.sourceBlock(i, cell.source, false);
    const promptY = frameY + CODE_PAD_Y;
    if (cell.count === null && cell.outputs.length === 0) {
      this.layers.push(
        this.promptLabel(
          `nb-${i}-prompt`,
          `nb-${i}-frame`,
          promptY,
          this.g.compact ? "[ ]:" : "In [ ]:",
          this.pal.muted,
          i * 1000 + 2,
        ),
      );
      this.y += CELL_GAP;
      return;
    }
    const error = cell.outputs.some((o) => o.kind === "error");
    const data: RunData = {
      count: cell.count,
      ms: runMs(cell.outputs),
      error,
      color: this.pal.promptIn,
      errorColor: this.pal.promptOut,
      compact: this.g.compact,
    };
    const run: CustomLayer = {
      id: `nb-${i}-run`,
      kind: "custom",
      task: RUN_TASK,
      role: "button",
      parent,
      box: { x: this.g.promptX, y: promptY, w: this.g.promptW, h: PROMPT_H },
      z: 2,
      priority: i * 1000 + 2,
      data,
      meta: { cell: i },
    };
    this.layers.push(run);
    this.usesRun = true;
    this.y += cell.outputs.length > 0 ? 6 : 0;
    cell.outputs.forEach((out, j) => {
      this.output(i, j, out, run.id, cell.count);
    });
    this.y += CELL_GAP;
  }

  textOutput(text: string, ansi: boolean): { html: string; plain: string } {
    let body = text.replace(/\n$/, "");
    let more = 0;
    const lines = body.split("\n");
    if (lines.length > this.maxLines) {
      more = lines.length - this.maxLines;
      body = lines.slice(0, this.maxLines).join("\n");
      this.clipped++;
    }
    const theme = this.pal.scheme === "dark" ? LOOM_INK : LOOM_PAPER;
    let html = ansi && this.opts.ansi !== "strip" ? ansiToHtml(body, theme) : escapeHtml(stripAnsi(body));
    let plain = stripAnsi(body);
    if (more > 0) {
      const note = `… ${more} more line${more === 1 ? "" : "s"}`;
      html += `\n<span style="color:${this.pal.muted}">${note}</span>`;
      plain += `\n${note}`;
    }
    return { html, plain };
  }

  pushText(
    id: string,
    parent: string,
    html: string,
    text: string,
    style: MeasureStyle,
    role: string,
    meta: Record<string, unknown>,
    priority: number,
  ): void {
    const { cellX, cellW } = this.g;
    let h = Math.max(style.linePx + 2 * style.padY, this.measure.height(html, cellW, style));
    const css = { ...style.css };
    if (h > this.maxOutH) {
      h = this.maxOutH;
      css.overflow = "hidden";
      this.clipped++;
    }
    this.layers.push({
      id,
      kind: "text",
      role,
      parent,
      box: { x: cellX, y: this.y, w: cellW, h },
      z: 1,
      priority,
      text,
      html,
      style: css,
      reveal: "fade",
      meta,
    });
    this.y += h;
  }

  imageOutput(id: string, parent: string, out: ImageOutput, priority: number, meta: Record<string, unknown>): boolean {
    const natural = imageSize(out.mime, out.data);
    if (!natural) return false;
    const maxW = this.g.cellW - 2 * PAD_X;
    let w = out.width ?? natural.w;
    let h = out.width && out.height ? out.height : (w * natural.h) / natural.w;
    const fit = Math.min(1, maxW / w, this.maxOutH / h);
    w = Math.max(1, Math.round(w * fit));
    h = Math.max(1, Math.round(h * fit));
    const layer: ImageLayer = {
      id,
      kind: "image",
      role: "figure",
      parent,
      box: { x: this.g.cellX + PAD_X, y: this.y + OUT_PAD_Y, w, h },
      z: 1,
      priority,
      src: `data:${out.mime};base64,${out.data}`,
      natural,
      fit: "contain",
      style: { "border-radius": "4px" },
      reveal: "sweep",
      meta: { ...meta, ...(out.alt ? { alt: out.alt } : {}) },
    };
    this.layers.push(layer);
    this.y += h + 2 * OUT_PAD_Y;
    return true;
  }

  output(i: number, j: number, out: Output, parent: string, count: number | null): void {
    const id = `nb-${i}-out${j}`;
    const priority = i * 1000 + 3 + j * 2;
    const meta = { cell: i, output: out.kind };
    const startY = this.y;
    const outStyle = (extra: CSSMap): MeasureStyle => ({
      css: mono(CODE_FONT_PX, OUT_LINE_PX, {
        padding: `${OUT_PAD_Y}px ${PAD_X}px`,
        color: this.pal.ink,
        "border-radius": "6px",
        ...extra,
      }),
      fontPx: CODE_FONT_PX,
      linePx: OUT_LINE_PX,
      charEm: 0.6,
      padY: OUT_PAD_Y,
      padX: PAD_X,
    });
    const htmlStyle: MeasureStyle = {
      css: { padding: `${OUT_PAD_Y}px ${PAD_X}px`, "box-sizing": "border-box" },
      fontPx: 13,
      linePx: 19.5,
      charEm: 0.55,
      padY: OUT_PAD_Y,
      padX: PAD_X,
    };
    let shown = true;
    switch (out.kind) {
      case "stream": {
        const { html, plain } = this.textOutput(out.text, true);
        const extra: CSSMap = out.name === "stderr" ? { "background-color": this.pal.stderr } : {};
        this.pushText(id, parent, html, plain, outStyle(extra), "output", meta, priority);
        break;
      }
      case "error": {
        const { html, plain } = this.textOutput(out.traceback, true);
        this.pushText(
          id,
          parent,
          html,
          plain,
          outStyle({ "background-color": this.pal.error }),
          "output",
          meta,
          priority,
        );
        break;
      }
      case "text": {
        const { html, plain } = this.textOutput(out.text, false);
        this.pushText(id, parent, html, plain, outStyle({}), "output", meta, priority);
        break;
      }
      case "image":
        shown = this.imageOutput(id, parent, out, priority, meta);
        if (!shown) {
          this.dropped++;
          this.notes.push("An image output could not be read.");
        }
        break;
      case "markdown": {
        const html = `<div class="slnb-md">${this.markdown(out.markdown)}</div>`;
        this.pushText(id, parent, html, htmlText(html, this.doc), htmlStyle, "output", meta, priority);
        break;
      }
      case "html": {
        const clean = out.html.length > MAX_HTML ? "" : sanitizeHtml(out.html, this.doc);
        const wrapped = `<div class="slnb-html">${clean}</div>`;
        const text = htmlText(wrapped, this.doc);
        if (text || /<img\s/i.test(clean)) {
          this.pushText(id, parent, wrapped, text, htmlStyle, "output", meta, priority);
        } else if (out.plain) {
          const { html, plain } = this.textOutput(out.plain, false);
          this.pushText(id, parent, html, plain, outStyle({}), "output", meta, priority);
        } else {
          shown = false;
          this.dropped++;
          this.notes.push("An HTML output that needs scripts was not drawn.");
        }
        break;
      }
    }
    if (shown && "result" in out && out.result) {
      const label = this.g.compact ? `[${count ?? " "}]:` : `Out [${count ?? " "}]:`;
      this.layers.push(this.promptLabel(`${id}-prompt`, parent, startY + 2, label, this.pal.promptOut, priority + 1));
    }
    if (shown) this.y += OUT_GAP;
  }

  cell(i: number, cell: Cell): void {
    if (cell.kind === "markdown") this.markdownCell(i, cell.source, cell.attachments);
    else if (cell.kind === "raw") {
      this.sourceBlock(i, cell.source, true);
      this.y += CELL_GAP;
    } else this.codeCell(i, cell);
  }
}

/** Simulated run time of a cell: a little longer for more and heavier outputs. */
function runMs(outputs: readonly Output[]): number {
  let ms = 420;
  for (const o of outputs.slice(0, 6)) ms += o.kind === "image" ? 420 : o.kind === "error" ? 260 : 160;
  return Math.min(2200, ms);
}

/** Layers a cell needs at most. */
function layerCost(cell: Cell): number {
  return cell.kind === "code" ? 3 + 2 * cell.outputs.length : cell.kind === "raw" ? 2 : 1;
}

function firstHeading(nb: Notebook): string | undefined {
  for (const c of nb.cells) {
    if (c.kind !== "markdown") continue;
    const m = /^\s{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(c.source);
    if (m?.[1]) return m[1].replace(/[*_`]/g, "").trim().slice(0, 200);
  }
  return undefined;
}

/** The note shown for a notebook without drawable cells. */
function emptyLayer(g: Geometry, pal: NotebookPalette): TextLayer {
  const text = "This notebook has no cells.";
  return {
    id: "nb-empty",
    kind: "text",
    role: "paragraph",
    box: { x: g.cellX, y: g.margin, w: g.cellW, h: PROMPT_H },
    text,
    html: escapeHtml(text),
    style: { "font-size": "14px", "line-height": `${PROMPT_H}px`, color: pal.muted },
    reveal: "fade",
  };
}

/** Builds the blueprint of a parsed notebook. */
export function buildNotebookBlueprint(nb: Notebook, opts: NotebookLayoutOptions): Blueprint {
  const pal = notebookPalette(opts.theme);
  const css = notebookCss(pal);
  const g = geometry(opts.width);
  const measure = createMeasurer(opts.document, css);
  const b = new Builder(nb, g, pal, measure, opts);
  const maxLayers = Math.max(4, opts.maxLayers ?? 4000);
  try {
    for (let i = 0; i < nb.cells.length; i++) {
      const cell = nb.cells[i] as Cell;
      if (b.layers.length + layerCost(cell) > maxLayers) {
        const rest = nb.cells.length - i;
        b.dropped += rest;
        b.notes.push(`${rest} cells were not drawn (layer limit).`);
        break;
      }
      b.cell(i, cell);
    }
  } finally {
    measure.dispose();
  }
  if (b.layers.length === 0) {
    b.layers.push(emptyLayer(g, pal));
    b.y = g.margin + PROMPT_H + CELL_GAP;
  }
  const name = opts.name;
  const title = nb.title ?? firstHeading(nb) ?? name?.replace(/\.ipynb$/i, "") ?? "Notebook";
  const blueprint: Blueprint = {
    version: 1,
    source: { type: "notebook", ...(name ? { name } : {}), title },
    size: { w: g.stageW, h: Math.ceil(b.y - CELL_GAP + g.margin) },
    background: pal.page,
    scheme: pal.scheme,
    css,
    icon: notebookIcon(),
    layers: b.layers,
    ...(b.usesRun ? { plugins: ["notebook"] } : {}),
  };
  const dropped = nb.dropped + b.dropped;
  if (b.clipped > 0) b.notes.push(`${b.clipped} long outputs were shortened.`);
  if (dropped + b.clipped > 0) {
    const reason = [...nb.notes, ...new Set(b.notes)].join(" ") || "Some content was not drawn because of limits.";
    blueprint.truncated = { reason, dropped: dropped + b.clipped };
  }
  return blueprint;
}

/** Our own icon: two stacked cells and a run triangle. */
export function notebookIcon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#5B5BF7"/>' +
    '<rect x="22" y="16" width="28" height="13" rx="3" fill="#fff"/><rect x="22" y="35" width="28" height="13" rx="3" fill="#fff" opacity=".55"/>' +
    '<path d="M12 17.5v10l8-5z" fill="#FF6B5B"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
