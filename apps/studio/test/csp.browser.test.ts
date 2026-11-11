import { describe, expect, it } from "vitest";
import page from "../index.html?raw";
import { blockRemoteAssets } from "../src/csp";

/** A remote origin that refuses connections at once; only the CSP decision matters here. */
const REMOTE = "https://localhost:1";

/** The page policy declared in index.html. */
function pagePolicy(): string {
  const doc = new DOMParser().parseFromString(page, "text/html");
  const meta = doc.querySelector('head meta[http-equiv="Content-Security-Policy"]');
  const policy = meta?.getAttribute("content");
  if (!policy) throw new Error("index.html declares no Content-Security-Policy");
  return policy;
}

/** Loads document-like content into a frame under the page policy; returns the blocked requests. */
async function blockedRequests(offline: boolean): Promise<string[]> {
  const frame = document.createElement("iframe");
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${pagePolicy()}"><body>`;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument as Document;
  const blocked: string[] = [];
  doc.addEventListener("securitypolicyviolation", (e) => blocked.push(`${e.effectiveDirective} ${e.blockedURI}`));
  if (offline) blockRemoteAssets(doc);
  // What a sanitizer slip could leave in a Markdown or EPUB layout.
  doc.body.innerHTML = `
    <span style="background:url(${REMOTE}/u.png)">z</span>
    <svg width="10" height="10"><image href="${REMOTE}/i.png" width="10" height="10"/></svg>
    <link rel="stylesheet" href="${REMOTE}/s.css">`;
  doc.body.getBoundingClientRect();
  await new Promise((resolve) => setTimeout(resolve, 300));
  frame.remove();
  return blocked.sort();
}

describe("Studio page CSP (decisions-v1 C03)", () => {
  it("keeps scripts to Studio's own bundle and blocks plugins and form posts", () => {
    const policy = pagePolicy();
    expect(policy).toMatch(/(^|; )script-src 'self'( 'wasm-unsafe-eval')?(;|$)/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
  });

  it.each([
    ["remote assets on: https images load, remote stylesheets do not", false, [`style-src-elem ${REMOTE}/s.css`]],
    [
      "remote assets off: https images are blocked too",
      true,
      [`img-src ${REMOTE}/i.png`, `img-src ${REMOTE}/u.png`, `style-src-elem ${REMOTE}/s.css`],
    ],
  ])("%s", async (_label, offline, expected) => {
    expect(await blockedRequests(offline)).toEqual(expected);
  });
});
