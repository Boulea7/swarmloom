import type { SnapshotCommonOptions, SnapshotDom } from "@swarmloom/adapter-code";
import type { Blueprint, Layer, LayerRole } from "@swarmloom/core";

/**
 * Test stand-in for snapshot-dom's snapshot() (contracts/snapshot.ts), used until the real
 * snapshotter is merged. It reads the laid-out frame document the adapter hands over and reports
 * one layer per semantic element with its box and computed opacity, which is what these tests
 * check (animation poses, layout, scripts not running). It is NOT a snapshotter.
 */
const ROLES: [string, LayerRole][] = [
  ["header, section, footer, article", "section"],
  ["nav", "nav"],
  ["h1, h2, h3", "heading"],
  ["p", "paragraph"],
  ["li", "list-item"],
  ["a.btn", "button"],
  [".badge, .pill", "label"],
];

/** Opacity an element ends up painted with (product of its ancestors' opacities). */
function paintedOpacity(el: Element): number {
  let o = 1;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    o *= Number(cur.ownerDocument.defaultView?.getComputedStyle(cur).opacity ?? 1);
  }
  return o;
}

export const probeSnapshot: SnapshotDom = {
  async snapshot(root: Element | Document, opts?: SnapshotCommonOptions): Promise<Blueprint> {
    // The frame document comes from another realm, so `instanceof Document` would be false here.
    const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : (root.ownerDocument as Document);
    const layers: Layer[] = [];
    for (const [selector, role] of ROLES) {
      for (const el of Array.from(doc.querySelectorAll(selector))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        layers.push({
          id: el.id || `l${layers.length}`,
          kind: "text",
          role,
          box: { x: r.left, y: r.top, w: r.width, h: r.height },
          html: "",
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          style: {},
          opacity: Math.round(paintedOpacity(el) * 100) / 100,
        });
      }
    }
    const html = doc.documentElement;
    return {
      version: 1,
      source: opts?.source ?? { type: "dom" },
      size: { w: html.clientWidth, h: html.scrollHeight },
      background: doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? "#fff",
      layers,
    };
  },
  snapshotHtml: async () => {
    throw new Error("probe: only snapshot() is available");
  },
};
