import type { SnapshotDom, SnapshotHtmlOptions } from "@swarmloom/adapter-code";
import type { Blueprint, Layer, LayerRole } from "@swarmloom/core";

/**
 * Test stand-in for snapshot-dom's snapshotHtml (contracts/snapshot.ts), used until the real
 * snapshotter is merged. It lays the HTML out the same way (shadow root, fixed width, fonts and
 * images awaited) and reports one layer per semantic block with its measured box, so tests can
 * check what the adapter hands over: real elements, a sane layout, no external requests.
 * It is NOT a snapshotter: roles come from a plain tag table.
 */
const ROLES: [string, LayerRole][] = [
  [".loom-body", "section"],
  ["h1, h2, h3, h4, h5, h6", "heading"],
  ["p", "paragraph"],
  ["li", "list-item"],
  ["pre", "code"],
  ["table", "table"],
  ["tr", "row"],
  ["blockquote", "quote"],
  [".katex", "math"],
  ["img", "figure"],
];

async function settle(root: ShadowRoot, doc: Document): Promise<void> {
  await doc.fonts.ready;
  await Promise.all(Array.from(root.querySelectorAll("img"), (img) => img.decode().catch(() => undefined)));
}

export async function probeSnapshotHtml(html: string, opts: SnapshotHtmlOptions): Promise<Blueprint> {
  const doc = opts.document ?? document;
  const host = doc.createElement("div");
  host.style.cssText = `position:absolute;left:0;top:0;width:${opts.width}px;pointer-events:none`;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${opts.css ?? ""}</style>${html}`;
  doc.body.append(host);
  try {
    await settle(root, doc);
    const origin = host.getBoundingClientRect();
    const layers: Layer[] = [];
    for (const [selector, role] of ROLES) {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        layers.push({
          id: `l${layers.length}`,
          kind: role === "figure" ? "image" : "text",
          role,
          box: { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height },
          ...(role === "figure"
            ? {
                src: (el as HTMLImageElement).currentSrc,
                natural: { w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight },
              }
            : {
                html: "",
                text: (el.textContent ?? "").trim(),
                style: { "font-family": getComputedStyle(el).fontFamily },
              }),
        } as Layer);
      }
    }
    return {
      version: 1,
      source: opts.source ?? { type: "html" },
      size: { w: opts.width, h: origin.height },
      background: opts.background ?? "#fff",
      ...(opts.scheme ? { scheme: opts.scheme } : {}),
      ...(opts.css ? { css: opts.css } : {}),
      layers,
    };
  } finally {
    host.remove();
  }
}

export const probeSnapshot: SnapshotDom = {
  snapshot: async () => {
    throw new Error("probe: only snapshotHtml is available");
  },
  snapshotHtml: probeSnapshotHtml,
};
