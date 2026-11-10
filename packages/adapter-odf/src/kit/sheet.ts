import type {
  Adapter,
  AdapterContext,
  Blueprint,
  BlueprintSource,
  LayerRole,
  LoadedSource,
  Size,
  SourceInput,
} from "@swarmloom/core";
import { px } from "./css";
import { loadSnapshotHtml, type SnapshotHtml } from "./snapshot";

/**
 * A loaded document plus plain-English quality notes (substituted fonts, skipped content).
 *
 * `notes` mirrors the optional `LoadedSource.notes` member proposed for the core contract
 * (decisions-v1 F01); until it lands this structural extension stays assignable to LoadedSource.
 */
export interface LoadedDocument extends LoadedSource {
  /** One sentence per difference from the original. Omitted when nothing differs. */
  notes?: string[];
}

/** An adapter whose results carry quality notes. Assignable to the core `Adapter` contract. */
export interface DocumentAdapter extends Adapter {
  load(input: SourceInput, ctx: AdapterContext): Promise<LoadedDocument>;
}

/** Builds a {@link LoadedDocument}, dropping empty notes. */
export function loaded(
  blueprint: Blueprint,
  notes: readonly (string | undefined)[],
  dispose?: () => void,
): LoadedDocument {
  const kept = notes.filter((n): n is string => !!n);
  const out: LoadedDocument = { blueprint };
  if (kept.length > 0) out.notes = kept;
  if (dispose) out.dispose = dispose;
  return out;
}

/** Gap around and between sheets on the desk, in CSS px. */
export const DESK_PAD = 32;

const DESK = { light: "#E9E9EF", dark: "#16161F" } as const;

/**
 * Desk and sheet styles shared by the paged adapters: sheets are white paper with a soft shadow,
 * stacked in a centred column on a neutral desk. Format CSS is appended after this.
 */
export function deskCss(theme: "light" | "dark"): string {
  return [
    `.sl-desk{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:${DESK_PAD}px;padding:${DESK_PAD}px;background:${DESK[theme]};}`,
    ".sl-sheet{position:relative;box-sizing:border-box;flex:none;overflow:hidden;background:#fff;color:#111;",
    "box-shadow:0 1px 3px rgba(11,11,18,.12),0 10px 28px rgba(11,11,18,.10);text-align:start;}",
    ".sl-sheet *{box-sizing:border-box;}",
    ".sl-sheet img{max-width:none;}",
  ].join("");
}

/** A sheet: page, slide or chapter. `h` is the minimum height for reflowed sheets. */
export interface SheetSpec extends Size {
  /** Fixed-layout sheets clip at `h`; reflowed sheets grow with their content. */
  fixed?: boolean;
}

/** Opening tag of a sheet with its size. Close it with `</section>`. */
export function openSheet(spec: SheetSpec, extra: { className?: string; label?: string; style?: string } = {}): string {
  const size = spec.fixed
    ? `width:${px(spec.w)};height:${px(spec.h)};`
    : `width:${px(spec.w)};min-height:${px(spec.h)};`;
  const cls = extra.className ? `sl-sheet ${extra.className}` : "sl-sheet";
  const label = extra.label ? ` aria-label="${extra.label.replace(/["<>&]/g, "")}"` : "";
  return `<section class="${cls}"${label} style="${size}${extra.style ?? ""}">`;
}

/** HTML and CSS of a rendered document, ready for snapshotting. */
export interface SheetRender {
  /** Concatenated sheets (each opened with {@link openSheet}). */
  html: string;
  /** Format styles, appended to {@link deskCss}. */
  css: string;
  sheets: SheetSpec[];
  /** Role given to the sheet boxes in the blueprint. */
  role: LayerRole;
}

/** Options of {@link snapshotSheets}. */
export interface SnapshotSheetsOptions {
  ctx: AdapterContext;
  source: BlueprintSource;
  icon: string;
  /** Snapshot implementation. Default: @swarmloom/snapshot-dom, imported on first use. */
  snapshotHtml?: SnapshotHtml;
  /** Content the adapter left out because of its limits. */
  truncated?: { reason: string; dropped: number };
}

/** Validates the adapter context shared by every document adapter. */
export function checkContext(ctx: AdapterContext, format: string): void {
  if (!ctx || typeof ctx !== "object" || !ctx.document)
    throw new TypeError(`${format}: AdapterContext with a document is required`);
  if (!Number.isFinite(ctx.width) || ctx.width <= 0)
    throw new RangeError(`${format}: ctx.width must be positive, got ${ctx.width}`);
  if (ctx.theme !== "light" && ctx.theme !== "dark")
    throw new TypeError(`${format}: ctx.theme must be "light" or "dark"`);
  ctx.signal?.throwIfAborted();
}

/**
 * Lays the sheets out on the desk with snapshot-dom and returns the blueprint: sheet boxes carry
 * `role` (page/slide), the adapter's own truncation is merged with the snapshotter's, and the
 * source metadata is kept.
 */
export async function snapshotSheets(render: SheetRender, opts: SnapshotSheetsOptions): Promise<Blueprint> {
  const { ctx } = opts;
  const snap = opts.snapshotHtml ?? (await loadSnapshotHtml());
  ctx.signal?.throwIfAborted();
  const widest = render.sheets.reduce((w, s) => Math.max(w, s.w), 0);
  const width = Math.ceil(widest + 2 * DESK_PAD);
  const blueprint = await snap(`<div class="sl-desk">${render.html}</div>`, {
    width,
    css: deskCss(ctx.theme) + render.css,
    document: ctx.document,
    background: DESK[ctx.theme],
    scheme: "light",
    icon: opts.icon,
    source: opts.source,
    maxLayers: ctx.maxLayers,
    signal: ctx.signal,
  });
  blueprint.source = { ...blueprint.source, ...opts.source };
  blueprint.scheme ??= "light";
  blueprint.truncated = mergeTruncated(blueprint.truncated, opts.truncated);
  if (!blueprint.truncated) delete blueprint.truncated;
  markSheets(blueprint, render.sheets, render.role);
  return blueprint;
}

function mergeTruncated(
  a: Blueprint["truncated"],
  b: SnapshotSheetsOptions["truncated"],
): Blueprint["truncated"] | undefined {
  if (!a) return b && b.dropped > 0 ? b : undefined;
  if (!b || b.dropped <= 0) return a;
  return { reason: `${b.reason} ${a.reason}`, dropped: a.dropped + b.dropped };
}

/**
 * Gives the sheet boxes their role. The snapshotter knows nothing about sheets, so they are found
 * by geometry: role-less boxes whose width matches a sheet and whose height reaches its minimum.
 */
export function markSheets(blueprint: Blueprint, sheets: readonly SheetSpec[], role: LayerRole): void {
  const tol = 1.5;
  const fits = (box: { w: number; h: number }, s: SheetSpec) =>
    Math.abs(box.w - s.w) <= tol && box.h >= s.h - tol && (!s.fixed || Math.abs(box.h - s.h) <= tol);
  for (const layer of blueprint.layers) {
    if (layer.kind !== "box" || layer.role) continue;
    if (sheets.some((s) => fits(layer.box, s))) layer.role = role;
  }
}
