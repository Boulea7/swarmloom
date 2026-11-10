import type { Blueprint, Layer, Rect } from "@swarmloom/core";
import { createSandbox, type SnapshotHtmlFn, type SnapshotHtmlOptions, waitForAssets } from "../src/paged/index";

/** One call of the fake snapshotter. */
export interface SnapshotCall {
  html: string;
  opts: SnapshotHtmlOptions;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Test stand-in for snapshot-dom's `snapshotHtml` (contracts/snapshot.ts), used while the real one is
 * not available in this worktree. It lays the HTML out in its own sandbox at the given width (as
 * snapshot-dom does) and emits a box layer per `<section>` and a text layer per text node, without
 * parents, so the adapters' page matching and parenting are exercised for real.
 */
export function fakeSnapshotHtml(calls: SnapshotCall[] = []): SnapshotHtmlFn {
  return async (html, opts) => {
    calls.push({ html, opts });
    const doc = opts.document ?? document;
    const sandbox = createSandbox(doc, opts.width);
    try {
      if (opts.css) sandbox.addCss(opts.css);
      sandbox.root.innerHTML = html;
      await waitForAssets(sandbox.root);
      const origin = sandbox.root.getBoundingClientRect();
      const rel = (r: DOMRect): Rect => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      const layers: Layer[] = [];
      let n = 0;
      for (const section of Array.from(sandbox.root.querySelectorAll("section"))) {
        layers.push({
          id: `box-${++n}`,
          kind: "box",
          box: rel(section.getBoundingClientRect()),
          role: "section",
          style: { "background-color": "#ffffff" },
        });
      }
      const walker = doc.createTreeWalker(sandbox.root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const heading = node.parentElement?.closest("h1, h2, h3, h4, h5, h6, [role='heading']");
        layers.push({
          id: `text-${++n}`,
          kind: "text",
          box: rel(rect),
          role: heading ? "heading" : "paragraph",
          html: escapeHtml(text),
          text,
          style: {},
        });
      }
      const blueprint: Blueprint = {
        version: 1,
        source: opts.source ?? { type: "html" },
        size: { w: opts.width, h: Math.ceil(sandbox.root.getBoundingClientRect().height) },
        viewport: { w: opts.width, h: Math.ceil(sandbox.root.getBoundingClientRect().height) },
        background: opts.background ?? "#ffffff",
        scheme: opts.scheme,
        css: opts.css,
        icon: opts.icon,
        layers,
      };
      return blueprint;
    } finally {
      sandbox.dispose();
    }
  };
}
