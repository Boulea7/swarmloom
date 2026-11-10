import { safeImageUrl } from "../util/html";

function largestSize(sizes: string | null): number {
  if (!sizes) return 0;
  if (sizes.trim().toLowerCase() === "any") return 1024;
  let best = 0;
  for (const token of sizes.split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/i.exec(token);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best;
}

/**
 * Favicon of a document: SVG icons first, then the largest declared icon, then apple-touch-icon,
 * then `/favicon.ico` for http(s) pages. Returns undefined when nothing safe is available.
 */
export function pageIcon(doc: Document): string | undefined {
  const base = doc.baseURI;
  let best: { url: string; score: number } | null = null;
  for (const link of Array.from(doc.querySelectorAll("link[rel][href]"))) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const href = link.getAttribute("href") ?? "";
    const url = safeImageUrl(href, base);
    if (!url) continue;
    let score = -1;
    if (rel.includes("icon")) {
      const type = (link.getAttribute("type") ?? "").toLowerCase();
      score =
        type === "image/svg+xml" || /\.svg(?:[?#]|$)/i.test(href)
          ? 4096
          : 100 + largestSize(link.getAttribute("sizes"));
    } else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
      score = 50 + largestSize(link.getAttribute("sizes"));
    }
    if (score >= 0 && (!best || score > best.score)) best = { url, score };
  }
  if (best) return best.url;
  try {
    const u = new URL(doc.URL);
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.origin}/favicon.ico`;
  } catch {
    // about:blank, srcdoc and other documents without a usable URL have no default icon.
  }
  return undefined;
}
