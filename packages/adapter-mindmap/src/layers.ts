/**
 * Mind map layout -> Blueprint: one box and one text layer per topic, one bezier connector per
 * edge. Build order follows the tree (root, then branches, then leaves): every connector waits
 * for its parent topic and every topic waits for its connector.
 */

import type { Blueprint, BoxLayer, Layer, PathLayer, TextLayer } from "@swarmloom/core";
import { type MeasureText, type MindLayout, type PlacedNode, UI_FONT } from "./layout";
import type { MindMap } from "./parse";

export interface MindmapLayerOptions {
  theme: "light" | "dark";
  /** Stage width; the map is centred in it. */
  width: number;
  name?: string;
  /** Most layers emitted (3 per topic). */
  maxLayers?: number;
  measure?: MeasureText;
}

/** Branch colours: the SwarmLoom cursor palette. */
export const BRANCH_COLORS = [
  "#FF6B5B",
  "#14B8A6",
  "#F5A524",
  "#5B5BF7",
  "#FF4F7B",
  "#7C5CF0",
  "#0EA5C6",
  "#3FA34D",
] as const;

const MARGIN = 40;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function tint(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function colorOf(n: PlacedNode): string {
  return n.branch < 0 ? "#5B5BF7" : (BRANCH_COLORS[n.branch % BRANCH_COLORS.length] as string);
}

/** Cubic connector from the parent's facing edge to the child's facing edge. */
export function connectorPath(parent: PlacedNode, child: PlacedNode, ox: number, oy: number): string {
  const right = child.side >= 0;
  const x1 = ox + (right ? parent.x + parent.w : parent.x);
  const y1 = oy + parent.y + parent.h / 2;
  const x2 = ox + (right ? child.x : child.x + child.w);
  // Leaves sit on an underline, so their connector meets the bottom edge.
  const y2 = oy + child.y + (child.depth >= 2 ? child.h - 1 : child.h / 2);
  const mx = (x1 + x2) / 2;
  const r = (v: number): number => Math.round(v * 10) / 10;
  const end = child.depth >= 2 ? ` H ${r(right ? x2 + child.w : x2 - child.w)}` : "";
  return `M ${r(x1)} ${r(y1)} C ${r(mx)} ${r(y1)}, ${r(mx)} ${r(y2)}, ${r(x2)} ${r(y2)}${end}`;
}

/** Builds the blueprint of a laid-out map. */
export function buildMindmapBlueprint(map: MindMap, layout: MindLayout, opts: MindmapLayerOptions): Blueprint {
  const dark = opts.theme === "dark";
  const ink = dark ? "#E6E7EF" : "#1D1E2C";
  const card = dark ? "#171824" : "#FFFFFF";
  const w = Math.max(opts.width, layout.width + 2 * MARGIN);
  const ox = Math.round((w - layout.width) / 2);
  const oy = MARGIN;
  const maxLayers = Math.max(3, opts.maxLayers ?? 4500);
  const layers: Layer[] = [];
  const ids = new Map<PlacedNode, { box: string; text: string }>();
  let dropped = map.dropped;

  // Breadth-first order so truncation keeps whole levels near the root.
  const order = [...layout.nodes].sort((a, b) => a.depth - b.depth);
  for (const n of order) {
    if (layers.length + 3 > maxLayers || (n.parent && !ids.has(n.parent))) {
      dropped++;
      continue;
    }
    const color = colorOf(n);
    const base = `mm-${n.node.id}`;
    const box = { x: ox + n.x, y: oy + n.y, w: n.w, h: n.h };
    const priority = n.depth * 10_000 + layers.length;
    let connector: string | undefined;
    if (n.parent) {
      const from = ids.get(n.parent) as { box: string; text: string };
      const d = connectorPath(n.parent, n, ox, oy);
      const xs = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const px = xs.filter((_, i) => i % 2 === 0);
      const py = xs.filter((_, i) => i % 2 === 1);
      const minX = Math.min(...px);
      const minY = Math.min(...py);
      const path: PathLayer = {
        id: `${base}-edge`,
        kind: "path",
        role: "shape",
        parent: from.text,
        box: {
          x: minX,
          y: minY - 2,
          w: Math.max(1, Math.max(...px) - minX),
          h: Math.max(4, Math.max(...py) - minY + 4),
        },
        z: 1,
        priority,
        d,
        stroke: color,
        strokeWidth: n.depth === 1 ? 3 : n.depth === 2 ? 2 : 1.5,
        fill: "none",
        attrs: { "stroke-linecap": "round", "stroke-linejoin": "round" },
        reveal: "pen",
        meta: { depth: n.depth },
      };
      layers.push(path);
      connector = path.id;
    }
    const style: Record<string, string> =
      n.depth === 0
        ? {
            "background-color": "#5B5BF7",
            "border-radius": `${Math.round(14 * layout.scale)}px`,
            "box-shadow": "0 14px 34px -16px rgba(91,91,247,0.65)",
          }
        : n.depth === 1
          ? {
              "background-color": card,
              border: `2px solid ${color}`,
              "border-radius": `${Math.round(10 * layout.scale)}px`,
              "box-shadow": `0 8px 20px -14px ${tint(color, 0.8)}`,
            }
          : {
              "background-color": tint(color, dark ? 0.16 : 0.1),
              "border-radius": `${Math.round(6 * layout.scale)}px`,
            };
    const boxLayer: BoxLayer = {
      id: `${base}-box`,
      kind: "box",
      role: n.depth === 0 ? "heading" : "shape",
      ...(connector ? { parent: connector } : {}),
      box,
      z: 2,
      priority: priority + 1,
      style,
      meta: {
        depth: n.depth,
        ...(n.node.note ? { note: n.node.note } : {}),
        ...(n.node.folded ? { folded: true } : {}),
      },
    };
    const color2 = n.depth === 0 ? "#FFFFFF" : ink;
    const html = n.lines.map((l) => escapeHtml(l)).join("<br>");
    const body = n.node.link
      ? `<a href="${escapeHtml(n.node.link)}" style="color:inherit;text-decoration:underline;text-decoration-color:${color}">${html}</a>`
      : html;
    const text: TextLayer = {
      id: `${base}-text`,
      kind: "text",
      role: n.depth === 0 ? "heading" : "paragraph",
      parent: boxLayer.id,
      box,
      z: 3,
      priority: priority + 2,
      text: n.lines.join("\n"),
      html: body,
      fontSize: n.fontSize,
      reveal: "type",
      style: {
        "font-family": UI_FONT,
        "font-size": `${n.fontSize}px`,
        "font-weight": n.depth === 0 ? "700" : n.depth === 1 ? "600" : "500",
        "line-height": `${n.lineHeight}px`,
        color: color2,
        "text-align": "center",
        "padding-top": `${Math.max(0, Math.round(((n.h - n.lines.length * n.lineHeight) / 2) * 10) / 10)}px`,
        "box-sizing": "border-box",
        "white-space": "pre",
      },
    };
    layers.push(boxLayer, text);
    ids.set(n, { box: boxLayer.id, text: text.id });
  }

  const blueprint: Blueprint = {
    version: 1,
    source: { type: "mindmap", ...(opts.name ? { name: opts.name } : {}), title: map.title || map.root.title },
    size: { w, h: layout.height + 2 * MARGIN },
    background: dark ? "#0B0B12" : "#FAFAFC",
    scheme: opts.theme,
    icon: mindmapIcon(),
    layers,
  };
  if (dropped > 0)
    blueprint.truncated = { reason: map.notes.join(" ") || "Some topics were not drawn because of limits", dropped };
  return blueprint;
}

/** Our own icon: a central node with three branches. */
export function mindmapIcon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="16" fill="#5B5BF7"/>' +
    '<path d="M32 32C40 32 40 20 48 20M32 32H48M32 32C40 32 40 44 48 44M32 32C24 32 24 24 16 24M32 32C24 32 24 40 16 40" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="32" cy="32" r="6" fill="#FF6B5B"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
