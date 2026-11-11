/**
 * Parsed patch -> Blueprint: per commit a header (subject, author chip, date, hash), per file a
 * code-review panel (path, status badge, +/- counts, hunk headers, one row per line with old/new
 * line numbers).
 */

import type { Blueprint, BoxLayer, CustomLayer, Layer, Rect, TextLayer } from "@swarmloom/core";
import { type AuthorLabel, labelAuthors } from "./authors";
import type { DiffCommit, DiffFile, DiffLine, Hunk, ParsedPatch } from "./parse";
import { DIFF_PLUGIN, type DiffLineData, LINE_TASK } from "./plugin";

export const MONO_FONT =
  'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

export interface DiffLayoutOptions {
  document: Document;
  width: number;
  theme: "light" | "dark";
  /** Show authors as "Author 1..n" and drop names and e-mails. */
  anonymize?: boolean;
  /** Most layers emitted; later files are dropped and counted in `truncated`. */
  maxLayers?: number;
  name?: string;
  /** Tab width in columns. Default 4. */
  tabSize?: number;
}

const MARGIN = 24;
const MAX_PANEL_W = 1200;
const ROW_H = 20;
const HUNK_H = 26;
const FILE_HEAD_H = 40;
const COMMIT_H = 58;
const PANEL_GAP = 16;
const COMMIT_GAP = 28;
const FONT_SIZE = 12.5;
const SIGN_W = 18;

interface Palette {
  page: string;
  panel: string;
  border: string;
  head: string;
  text: string;
  muted: string;
  hunkBg: string;
  hunkText: string;
  addBg: string;
  addNum: string;
  addSign: string;
  delBg: string;
  delNum: string;
  delSign: string;
  strike: string;
  select: string;
}

const LIGHT: Palette = {
  page: "#FAFAFC",
  panel: "#FFFFFF",
  border: "#E3E4EE",
  head: "#F4F4FA",
  text: "#1D1E2C",
  muted: "#6B6E85",
  hunkBg: "#EEEEFE",
  hunkText: "#4B4FC9",
  addBg: "#E8F7EE",
  addNum: "#D3F0DE",
  addSign: "#1F8A52",
  delBg: "#FDECEE",
  delNum: "#F9D9DE",
  delSign: "#C8283C",
  strike: "#C8283C",
  select: "rgba(91,91,247,0.24)",
};

const DARK: Palette = {
  page: "#0B0B12",
  panel: "#13141D",
  border: "#2A2C3C",
  head: "#1A1B27",
  text: "#E6E7EF",
  muted: "#9092A8",
  hunkBg: "#1D1E3A",
  hunkText: "#A3A8FF",
  addBg: "#12291D",
  addNum: "#173523",
  addSign: "#4FD08A",
  delBg: "#2E1418",
  delNum: "#3B181D",
  delSign: "#FF7A88",
  strike: "#FF7A88",
  select: "rgba(123,140,255,0.32)",
};

function stageCss(c: Palette): string {
  return [
    `.sld-row{display:flex;height:${ROW_H}px;line-height:${ROW_H}px;font-family:${MONO_FONT};font-size:${FONT_SIZE}px;color:${c.text};white-space:pre;overflow:hidden;opacity:0}`,
    `.sld-num{flex:none;padding:0 8px 0 0;box-sizing:border-box;text-align:right;color:${c.muted};user-select:none}`,
    `.sld-sign{flex:none;text-align:center;user-select:none}`,
    `.sld-body{position:relative;flex:1;min-width:0;overflow:hidden}`,
    `.sld-code{position:relative;z-index:1}`,
    `.sld-add{background:${c.addBg}}.sld-add .sld-num{background:${c.addNum}}.sld-add .sld-sign{color:${c.addSign}}`,
    `.sld-del{background:${c.delBg}}.sld-del .sld-num{background:${c.delNum}}.sld-del .sld-sign{color:${c.delSign}}`,
    `.sld-strike{position:absolute;left:0;top:50%;height:1.5px;margin-top:-0.75px;background:${c.strike};transform-origin:0 50%;transform:scaleX(0);z-index:2}`,
    `.sld-sel{position:absolute;left:0;top:2px;bottom:2px;background:${c.select};opacity:0;border-radius:2px}`,
    `.sld-eof{margin-left:6px;color:${c.muted};font-size:11px}`,
  ].join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Advance of one monospace cell at `size` px (canvas when available, else 0.6 em). */
export function measureMono(doc: Document, size: number): number {
  let w = 0;
  try {
    const ctx = doc.createElement("canvas").getContext?.("2d");
    if (ctx) {
      ctx.font = `${size}px ${MONO_FONT}`;
      w = ctx.measureText("0123456789".repeat(4)).width / 40;
    }
  } catch {
    w = 0;
  }
  return Number.isFinite(w) && w > size * 0.3 && w < size * 1.2 ? Math.round(w * 100) / 100 : size * 0.6;
}

function expandTabs(text: string, tab: number): string {
  if (!text.includes("\t")) return text;
  let out = "";
  for (const ch of text) {
    if (ch === "\t") out += " ".repeat(tab - (out.length % tab));
    else out += ch;
  }
  return out;
}

function filePath(f: DiffFile): string {
  if (f.status === "renamed" || f.status === "copied") return `${f.oldPath ?? ""} → ${f.newPath ?? ""}`;
  return f.newPath ?? f.oldPath ?? "(unknown file)";
}

function badgeOf(f: DiffFile): string | null {
  const parts: string[] = [];
  if (f.status !== "modified")
    parts.push(f.similarity !== undefined && f.status !== "added" ? `${f.status} ${f.similarity}%` : f.status);
  if (f.binary) parts.push("binary");
  if (f.oldMode && f.newMode && f.oldMode !== f.newMode) parts.push(`mode ${f.oldMode} → ${f.newMode}`);
  return parts.length ? parts.join(" · ") : null;
}

function counts(f: DiffFile): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const h of f.hunks) for (const l of h.lines) l.kind === "add" ? add++ : l.kind === "del" ? del++ : 0;
  return { add, del };
}

function shortDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return date.slice(0, 40);
  return new Date(t).toISOString().slice(0, 10);
}

function textLayer(
  id: string,
  box: Rect,
  text: string,
  html: string,
  style: Record<string, string>,
  extra: Partial<TextLayer> = {},
): TextLayer {
  return { id, kind: "text", box, text, html, style, ...extra };
}

/**
 * Builds the review blueprint. Deterministic: depends on the patch, the options and the measured
 * monospace cell width only.
 */
export function buildDiffBlueprint(patch: ParsedPatch, opts: DiffLayoutOptions): Blueprint {
  const c = opts.theme === "dark" ? DARK : LIGHT;
  const tab = Math.max(1, Math.min(16, opts.tabSize ?? 4));
  const cellW = measureMono(opts.document, FONT_SIZE);
  const panelW = Math.max(320, Math.min(MAX_PANEL_W, opts.width - 2 * MARGIN));
  const x0 = Math.max(MARGIN, Math.round((opts.width - panelW) / 2));
  const maxLayers = Math.max(10, opts.maxLayers ?? 6000);
  const labels = labelAuthors(patch.commits, opts.anonymize === true);
  const layers: Layer[] = [];
  let dropped = patch.dropped;
  let y = MARGIN;
  let stop = false;

  patch.commits.forEach((commit, ci) => {
    if (stop) {
      dropped += commit.files.length;
      return;
    }
    const author = labels.get(commit);
    const meta = author ? { author: author.label } : undefined;
    if (ci > 0) y += COMMIT_GAP - PANEL_GAP;
    if (commit.subject || author || commit.id) {
      y = commitHeader(layers, commit, author, ci, x0, y, panelW, c);
    }
    commit.files.forEach((file, fi) => {
      if (stop) {
        dropped++;
        return;
      }
      const lines = file.hunks.reduce((n, h) => n + h.lines.length + 1, 0);
      if (layers.length + lines + 6 > maxLayers) {
        stop = true;
        dropped++;
        return;
      }
      y = filePanel(layers, file, `c${ci}f${fi}`, x0, y, panelW, c, cellW, tab, author, meta) + PANEL_GAP;
    });
  });

  const first = patch.commits[0];
  const title = first?.subject ?? (first?.files[0] ? filePath(first.files[0]) : undefined) ?? opts.name ?? "Patch";
  const blueprint: Blueprint = {
    version: 1,
    source: { type: "diff", ...(opts.name ? { name: opts.name } : {}), title },
    size: { w: opts.width, h: Math.max(y - PANEL_GAP + MARGIN, 120) },
    viewport: { w: opts.width, h: Math.min(Math.max(y, 120), 900) },
    background: c.page,
    scheme: opts.theme,
    css: stageCss(c),
    icon: diffIcon(),
    layers,
    plugins: [DIFF_PLUGIN],
  };
  if (dropped > 0)
    blueprint.truncated = {
      reason: "The patch is larger than the layer budget; later lines and files were dropped",
      dropped,
    };
  return blueprint;
}

function commitHeader(
  layers: Layer[],
  commit: DiffCommit,
  author: AuthorLabel | undefined,
  ci: number,
  x: number,
  y: number,
  w: number,
  c: Palette,
): number {
  const id = `c${ci}`;
  const subject = commit.subject ?? (commit.id ? `Commit ${commit.id.slice(0, 7)}` : "Changes");
  const meta = author ? { author: author.label } : undefined;
  layers.push(
    textLayer(
      `${id}-subject`,
      { x, y, w, h: 26 },
      subject,
      escapeHtml(subject),
      {
        "font-family": UI_FONT,
        "font-size": "17px",
        "font-weight": "650",
        "line-height": "26px",
        color: c.text,
        "white-space": "nowrap",
        overflow: "hidden",
        "text-overflow": "ellipsis",
      },
      { role: "heading", fontSize: 17, reveal: "type", ...(meta ? { meta } : {}) },
    ),
  );
  const bits: string[] = [];
  const htmlBits: string[] = [];
  if (author) {
    bits.push(author.label);
    htmlBits.push(
      `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${author.color};margin-right:6px"></span><span style="color:${c.text};font-weight:600">${escapeHtml(author.label)}</span>`,
    );
  }
  const date = shortDate(commit.date);
  if (date) {
    bits.push(date);
    htmlBits.push(escapeHtml(date));
  }
  if (commit.id) {
    const short = escapeHtml(commit.id.slice(0, 7));
    bits.push(short);
    htmlBits.push(`<span style="font-family:${escapeHtml(MONO_FONT)}">${short}</span>`);
  }
  if (bits.length) {
    layers.push(
      textLayer(
        `${id}-meta`,
        { x, y: y + 28, w, h: 18 },
        bits.join(" · "),
        htmlBits.join(' <span style="opacity:0.5">·</span> '),
        {
          "font-family": UI_FONT,
          "font-size": "12.5px",
          "line-height": "18px",
          color: c.muted,
          "white-space": "nowrap",
        },
        { role: "paragraph", reveal: "fade", parent: `${id}-subject`, ...(meta ? { meta } : {}) },
      ),
    );
  }
  return y + COMMIT_H;
}

function filePanel(
  layers: Layer[],
  file: DiffFile,
  id: string,
  x: number,
  y: number,
  w: number,
  c: Palette,
  cellW: number,
  tab: number,
  author: AuthorLabel | undefined,
  meta: Record<string, unknown> | undefined,
): number {
  const maxNo = Math.max(9, ...file.hunks.map((h) => Math.max(h.oldStart + h.oldLines, h.newStart + h.newLines)));
  const numW = Math.ceil(String(maxNo).length * cellW + 16);
  let bodyH = 0;
  for (const h of file.hunks) bodyH += HUNK_H + h.lines.length * ROW_H;
  if (file.hunks.length === 0) bodyH = 44;
  const panel: BoxLayer = {
    id: `${id}`,
    kind: "box",
    role: "section",
    box: { x, y, w, h: FILE_HEAD_H + bodyH },
    style: {
      "background-color": c.panel,
      border: `1px solid ${c.border}`,
      "border-radius": "10px",
      "box-shadow": "0 10px 30px -22px rgba(11,11,18,0.45)",
    },
    ...(meta ? { meta } : {}),
  };
  const clip: Rect = { ...panel.box };
  const head: BoxLayer = {
    id: `${id}-head`,
    kind: "box",
    role: "nav",
    parent: panel.id,
    box: { x, y, w, h: FILE_HEAD_H },
    clip,
    style: { "background-color": c.head, "border-bottom": `1px solid ${c.border}`, "border-radius": "10px 10px 0 0" },
  };
  layers.push(panel, head);
  const { add, del } = counts(file);
  const stats = `+${add} −${del}`;
  const statsW = Math.ceil(stats.length * 7.5 + 12);
  const badge = badgeOf(file);
  const badgeW = badge ? Math.ceil(badge.length * 6.6 + 18) : 0;
  const path = filePath(file);
  layers.push(
    textLayer(
      `${id}-path`,
      { x: x + 14, y: y + 11, w: Math.max(60, w - 28 - statsW - badgeW - 16), h: 18 },
      path,
      escapeHtml(path),
      {
        "font-family": MONO_FONT,
        "font-size": "13px",
        "font-weight": "600",
        "line-height": "18px",
        color: c.text,
        "white-space": "nowrap",
        overflow: "hidden",
        "text-overflow": "ellipsis",
      },
      { role: "heading", parent: head.id, reveal: "type", fontSize: 13, clip, ...(meta ? { meta } : {}) },
    ),
  );
  if (badge) {
    layers.push(
      textLayer(
        `${id}-badge`,
        { x: x + w - 14 - statsW - badgeW, y: y + 10, w: badgeW, h: 20 },
        badge,
        escapeHtml(badge),
        {
          "font-family": UI_FONT,
          "font-size": "11px",
          "font-weight": "600",
          "line-height": "20px",
          "text-align": "center",
          color: c.hunkText,
          "background-color": c.hunkBg,
          "border-radius": "10px",
          "white-space": "nowrap",
        },
        { role: "button", parent: head.id, reveal: "stamp", clip },
      ),
    );
  }
  layers.push(
    textLayer(
      `${id}-stats`,
      { x: x + w - 14 - statsW, y: y + 11, w: statsW, h: 18 },
      stats,
      `<span style="color:${c.addSign}">+${add}</span> <span style="color:${c.delSign}">−${del}</span>`,
      {
        "font-family": MONO_FONT,
        "font-size": "12.5px",
        "font-weight": "600",
        "line-height": "18px",
        "text-align": "right",
        "white-space": "nowrap",
      },
      { role: "paragraph", parent: head.id, reveal: "fade", clip },
    ),
  );

  let rowY = y + FILE_HEAD_H;
  if (file.hunks.length === 0) {
    const note = file.binary
      ? "Binary file not shown"
      : file.status === "renamed" || file.status === "copied"
        ? `File ${file.status} without changes`
        : file.oldMode !== file.newMode && file.newMode
          ? "File mode changed"
          : "No content changes";
    layers.push(
      textLayer(
        `${id}-note`,
        { x: x + 14, y: rowY + 13, w: w - 28, h: 18 },
        note,
        escapeHtml(note),
        {
          "font-family": UI_FONT,
          "font-size": "12.5px",
          "line-height": "18px",
          color: c.muted,
          "font-style": "italic",
        },
        { role: "paragraph", parent: panel.id, reveal: "fade", clip },
      ),
    );
    return y + FILE_HEAD_H + bodyH;
  }

  file.hunks.forEach((hunk, hi) => {
    rowY = hunkRows(layers, hunk, `${id}h${hi}`, panel.id, x, rowY, w, c, cellW, numW, tab, author, clip, meta);
  });
  return y + FILE_HEAD_H + bodyH;
}

function hunkRows(
  layers: Layer[],
  hunk: Hunk,
  id: string,
  panelId: string,
  x: number,
  y: number,
  w: number,
  c: Palette,
  cellW: number,
  numW: number,
  tab: number,
  author: AuthorLabel | undefined,
  clip: Rect,
  meta: Record<string, unknown> | undefined,
): number {
  const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  const text = hunk.section ? `${range} ${hunk.section}` : range;
  const headId = `${id}`;
  layers.push(
    textLayer(
      headId,
      { x, y, w, h: HUNK_H },
      text,
      `<span style="opacity:0.8">${escapeHtml(range)}</span>${hunk.section ? ` ${escapeHtml(hunk.section)}` : ""}`,
      {
        "font-family": MONO_FONT,
        "font-size": "12px",
        "line-height": `${HUNK_H}px`,
        "padding-left": `${2 * numW + 6}px`,
        color: c.hunkText,
        "background-color": c.hunkBg,
        "white-space": "pre",
        overflow: "hidden",
      },
      { role: "code", parent: panelId, reveal: "fade", clip, ...(meta ? { meta } : {}) },
    ),
  );
  let rowY = y + HUNK_H;
  let firstChange = true;
  // Within a change block (removals followed by additions) the additions wait for the removals.
  let lastDel: string | null = null;
  hunk.lines.forEach((line: DiffLine, li) => {
    const lid = `${id}l${li}`;
    const data: DiffLineData = {
      v: 1,
      kind: line.kind,
      text: expandTabs(line.text, tab),
      numW,
      signW: SIGN_W,
      cellW,
      ...(line.oldNo !== undefined ? { oldNo: line.oldNo } : {}),
      ...(line.newNo !== undefined ? { newNo: line.newNo } : {}),
      ...(line.noNewline ? { noNewline: true } : {}),
    };
    if (line.kind !== "context" && firstChange && author) {
      data.author = author.label;
      firstChange = false;
    }
    let parent = headId;
    if (line.kind === "del") lastDel = lid;
    else if (line.kind === "add" && lastDel) parent = lastDel;
    else lastDel = null;
    const layer: CustomLayer = {
      id: lid,
      kind: "custom",
      task: LINE_TASK,
      role: "code",
      parent,
      box: { x, y: rowY, w, h: ROW_H },
      clip,
      data,
      meta: { ...(meta ?? {}), line: line.kind },
    };
    layers.push(layer);
    rowY += ROW_H;
  });
  return rowY;
}

/** Our own file-type icon: two offset sheets with a plus and a minus. */
export function diffIcon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#5B5BF7"/>' +
    '<rect x="15" y="14" width="22" height="28" rx="4" fill="#fff" opacity="0.55"/><rect x="27" y="22" width="22" height="28" rx="4" fill="#fff"/>' +
    '<path d="M33 31h10M38 26v10" stroke="#1F8A52" stroke-width="3" stroke-linecap="round"/><path d="M33 43h10" stroke="#FF6B5B" stroke-width="3" stroke-linecap="round"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
