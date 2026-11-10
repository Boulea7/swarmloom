/** Escapes text content for HTML. */
export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a value for a double-quoted HTML attribute. */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i;

function resolve(url: string, base: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, base);
  } catch {
    return null;
  }
}

/**
 * Absolute URL for an image source, or null when the URL is empty, malformed or uses a scheme
 * that must not reach the stage (`javascript:`, `data:text/html`, ...).
 * Allowed: http(s), blob and data: URLs of raster/SVG image types.
 */
export function safeImageUrl(url: string, base: string): string | null {
  const trimmed = url.trim();
  if (/^data:/i.test(trimmed)) return SAFE_IMAGE_DATA.test(trimmed) ? trimmed : null;
  const u = resolve(trimmed, base);
  if (!u) return null;
  if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "blob:" || u.protocol === "file:") {
    return u.href;
  }
  return null;
}

/** Absolute URL for a link target, or null for script-capable or unknown schemes. */
export function safeLinkUrl(url: string, base: string): string | null {
  const u = resolve(url, base);
  if (!u) return null;
  const p = u.protocol;
  if (p === "http:" || p === "https:" || p === "mailto:" || p === "tel:" || p === "file:") return u.href;
  return null;
}

/** True for URLs that would execute script or render active content when used as a link or source. */
export function isDangerousUrl(url: string): boolean {
  // Browsers ignore ASCII whitespace and control characters inside the scheme.
  let compact = "";
  for (let i = 0; i < url.length && compact.length < 32; i++) {
    const code = url.charCodeAt(i);
    if (code > 32 && code !== 127) compact += url[i];
  }
  compact = compact.toLowerCase();
  return (
    compact.startsWith("javascript:") ||
    compact.startsWith("vbscript:") ||
    compact.startsWith("data:text/html") ||
    compact.startsWith("data:application/xhtml") ||
    compact.startsWith("data:text/xml") ||
    compact.startsWith("data:application/xml")
  );
}
