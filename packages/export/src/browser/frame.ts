/**
 * The render page inside Studio's export frame. Loaded twice: by the exporter, only to learn this
 * module's URL, and by the frame itself through `<script type="module" src>`, where it installs
 * `window.__swarmloom` exactly as the CLI's render page does. Running core in the frame's own window
 * keeps its DOM checks (`instanceof HTMLElement`) and the frame's viewport, media queries and
 * animations apart from the page that exports.
 */

import { createPageRenderApi } from "../render/page";
import { FRAME_ATTRIBUTE, isExportFrame } from "./marker";

/** URL the export frame loads this module from. */
export const FRAME_MODULE_URL: string = import.meta.url;

/**
 * Keeps the host app's style sheets out of the render page. When the app and this module share
 * chunks, a bundler may list the app's entry CSS as a dependency of the adapters' lazy chunks (Vite
 * does), and its preloader then links that sheet into this document. The CLI's render page has no
 * linked sheets at all, so each one is switched off as it arrives. It still loads, so a preloader
 * waiting for it carries on.
 */
function muteLinkedStyleSheets(doc: Document): void {
  const mute = (node: Node) => {
    if (node.nodeName === "LINK" && /(?:^|\s)stylesheet(?:\s|$)/i.test((node as HTMLLinkElement).rel)) {
      (node as HTMLLinkElement).media = "not all";
    }
  };
  for (const link of doc.querySelectorAll("link")) mute(link);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) mute(node);
  }).observe(doc.head, { childList: true });
}

if (isExportFrame()) {
  muteLinkedStyleSheets(document);
  const network = window.frameElement?.getAttribute(FRAME_ATTRIBUTE) === "none" ? "none" : "https";
  window.__swarmloom = createPageRenderApi({ network });
  document.documentElement.dataset.swarmloom = "ready";
}
