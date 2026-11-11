/** Elements that never belong in a rebuilt document: active content, embeds, forms. */
const DROP = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "link",
  "meta",
  "base",
  "noscript",
  "template",
  "portal",
  "audio",
  "video",
  "source",
  "track",
  "foreignobject",
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "srcset", "background"]);
const SAFE_LINK = /^(?:https?:|mailto:|#)/i;
const SAFE_MEDIA = /^(?:data:image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml)[;,]|blob:)/i;

/**
 * Removes active content from a rendered document tree in place: scripts, frames, embeds and forms,
 * event-handler attributes, `style` URLs other than data/blob, and links or sources with unsafe schemes.
 * Links keep http(s), mailto and in-document anchors; images keep data/blob URLs only (no network).
 */
export function sanitizeTree(root: Element): void {
  const doomed: Element[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
  for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
    if (DROP.has(node.localName.toLowerCase())) {
      doomed.push(node);
      continue;
    }
    sanitizeAttributes(node);
  }
  for (const el of doomed) el.remove();
}

function sanitizeAttributes(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name)) {
      const value = attr.value.trim();
      const ok = name === "href" && el.localName === "a" ? SAFE_LINK.test(value) : SAFE_MEDIA.test(value);
      if (!ok) el.removeAttribute(attr.name);
    } else if (name === "style" && /url\s*\(|expression\s*\(/i.test(attr.value)) {
      el.setAttribute("style", stripStyleUrls(attr.value));
    }
  }
  if (el.localName === "a" && el.hasAttribute("href")) {
    el.setAttribute("rel", "noopener noreferrer nofollow");
    el.removeAttribute("target");
  }
}

/** Drops declarations that reference non-data URLs (they would fetch from the network). */
function stripStyleUrls(style: string): string {
  return style
    .split(";")
    .filter((decl) => {
      if (/expression\s*\(/i.test(decl)) return false;
      const urls = decl.match(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi) ?? [];
      return urls.every((u) => /url\s*\(\s*['"]?\s*data:/i.test(u));
    })
    .join(";");
}

/** Removes `@import` rules and non-data `url()` references from a style sheet (no network from documents). */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, _q: string, url: string) =>
      /^\s*(?:data:|blob:)/i.test(url) ? match : "none",
    )
    .replace(/expression\s*\(/gi, "(");
}
