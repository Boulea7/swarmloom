/**
 * Test helpers shared by the document adapters' browser tests.
 *
 * `snapshotHtmlForTests` uses @swarmloom/snapshot-dom when it implements `snapshotHtml`, and
 * otherwise a small stand-in that follows the same contract (contracts/snapshot.ts): it lays the
 * HTML out in a hidden shadow root at the requested width (real Chromium layout) and emits box,
 * text, image and path layers in element coordinates. The stand-in is deliberately simple; it only
 * exists so adapter tests can run before the real snapshotter is merged.
 */
import type { Blueprint, Layer } from "@swarmloom/core";
import type { SnapshotHtml, SnapshotHtmlOptions } from "../../src/kit/snapshot";

const SHAPES = new Set(["path", "rect", "ellipse", "circle", "line", "polygon", "polyline"]);

function visibleBox(cs: CSSStyleDeclaration): boolean {
  const bg = cs.backgroundColor;
  const hasBg = bg !== "" && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg);
  const hasBorder = ["Top", "Right", "Bottom", "Left"].some(
    (s) =>
      Number.parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 &&
      cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== "none",
  );
  return hasBg || hasBorder || (cs.boxShadow !== "" && cs.boxShadow !== "none");
}

function hasOwnText(el: Element): boolean {
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue?.trim()) return true;
  return false;
}

function isTextBlock(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  if (cs.display.startsWith("inline") && cs.display !== "inline-block" && cs.display !== "inline-flex") return false;
  if (!(el.textContent ?? "").trim()) return false;
  // A text block holds text directly or only through inline children.
  for (const c of Array.from(el.children)) {
    const d = getComputedStyle(c).display;
    if (!d.startsWith("inline") && d !== "contents" && d !== "none") return false;
  }
  return hasOwnText(el) || el.children.length > 0;
}

/** A minimal snapshotHtml stand-in (see the module comment). */
export const standInSnapshotHtml: SnapshotHtml = async (
  html: string,
  opts: SnapshotHtmlOptions,
): Promise<Blueprint> => {
  const doc = opts.document ?? document;
  const host = doc.createElement("div");
  host.setAttribute("data-swarmloom-sandbox", "");
  host.style.cssText = `position:absolute;left:-100000px;top:0;width:${opts.width}px`;
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `.sl-root{display:block;width:100%;margin:0;font:16px/1.5 sans-serif}${opts.css ?? ""}`;
  const root = doc.createElement("div");
  root.className = "sl-root";
  root.innerHTML = html;
  shadow.append(style, root);
  doc.body.append(host);
  try {
    await Promise.all(
      Array.from(root.querySelectorAll("img"), (img) =>
        Promise.race([img.decode().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]),
      ),
    );
    const origin = root.getBoundingClientRect();
    const layers: Layer[] = [];
    const ids = new Map<Element, string>();
    const walk = (el: Element, parent: string | undefined) => {
      const r = el.getBoundingClientRect();
      const box = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      const id = `l${layers.length}`;
      const base = { id, box, ...(parent ? { parent } : {}) };
      let mine = parent;
      if (el instanceof SVGElement) {
        if (SHAPES.has(el.localName) && box.w + box.h > 0) {
          layers.push({ ...base, kind: "path", d: `M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}z` });
        }
        for (const c of Array.from(el.children)) walk(c, mine);
        return;
      }
      if (!(el instanceof HTMLElement)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || box.w === 0 || box.h === 0) {
        if (cs.display === "contents") for (const c of Array.from(el.children)) walk(c, mine);
        return;
      }
      if (el instanceof HTMLImageElement) {
        layers.push({ ...base, kind: "image", src: el.currentSrc || el.src });
        return;
      }
      if (visibleBox(cs)) {
        layers.push({ ...base, kind: "box", style: { "background-color": cs.backgroundColor } });
        ids.set(el, id);
        mine = id;
      }
      if (isTextBlock(el, cs)) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        layers.push({
          ...base,
          id: `l${layers.length}`,
          kind: "text",
          text,
          html: el.innerHTML,
          style: {},
          ...(mine ? { parent: mine } : {}),
        });
        for (const c of Array.from(el.querySelectorAll("img"))) walk(c, mine);
        return;
      }
      for (const c of Array.from(el.children)) walk(c, mine);
    };
    for (const c of Array.from(root.children)) walk(c, undefined);
    const max = opts.maxLayers ?? 6000;
    const kept = layers.slice(0, max);
    const blueprint: Blueprint = {
      version: 1,
      source: opts.source ?? { type: "html" },
      size: { w: opts.width, h: Math.ceil(root.getBoundingClientRect().height) },
      background: opts.background ?? "#fff",
      layers: kept,
    };
    if (opts.css) blueprint.css = opts.css;
    if (opts.icon) blueprint.icon = opts.icon;
    if (opts.scheme) blueprint.scheme = opts.scheme;
    if (layers.length > max) blueprint.truncated = { reason: "Layer limit.", dropped: layers.length - max };
    return blueprint;
  } finally {
    host.remove();
  }
};

let resolved: Promise<SnapshotHtml> | undefined;

/** The real snapshotHtml when it works, else {@link standInSnapshotHtml}. */
export function snapshotHtmlForTests(): Promise<SnapshotHtml> {
  resolved ??= (async () => {
    try {
      const mod = (await import("@swarmloom/snapshot-dom")) as { snapshotHtml?: SnapshotHtml };
      if (typeof mod.snapshotHtml !== "function") return standInSnapshotHtml;
      await mod.snapshotHtml("<p>probe</p>", { width: 120 });
      return mod.snapshotHtml;
    } catch (error) {
      if (/not implemented/i.test(String(error))) return standInSnapshotHtml;
      throw error;
    }
  })();
  return resolved;
}

/** Fetches a sample file served by Vite (`?url` import). */
export async function fixture(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fixture ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Structural checks every blueprint must pass: unique ids, parents first, finite boxes. */
export function wellFormed(bp: Blueprint): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const layer of bp.layers) {
    if (seen.has(layer.id)) problems.push(`duplicate id ${layer.id}`);
    if (layer.parent && !seen.has(layer.parent)) problems.push(`${layer.id}: parent ${layer.parent} comes later`);
    seen.add(layer.id);
    const { x, y, w, h } = layer.box;
    if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0) problems.push(`${layer.id}: bad box`);
  }
  return problems;
}

/** Layer kinds present in a blueprint. */
export function kinds(bp: Blueprint): Set<string> {
  return new Set(bp.layers.map((l) => l.kind));
}

/** Plain text of all text layers, joined. */
export function allText(bp: Blueprint): string {
  return bp.layers
    .filter((l) => l.kind === "text")
    .map((l) => (l as { text: string }).text)
    .join(" ");
}
