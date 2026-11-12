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
    } else if (name === "style") {
      // Renderers copy some style attributes verbatim (docx-preview: VML shape styles).
      const clean = sanitizeCss(attr.value);
      if (clean !== attr.value) el.setAttribute("style", clean);
    }
  }
  if (el.localName === "a" && el.hasAttribute("href")) {
    el.setAttribute("rel", "noopener noreferrer nofollow");
    el.removeAttribute("target");
  }
}

/**
 * Decodes CSS escapes (`\75` hex, `\(` literal) so they cannot spell `url(`, `image-set(` or `@import`
 * in disguise, then drops the backslashes left over (from `\\` or `\5c`): kept, they would start new
 * escapes in the output. Invalid code points become U+FFFD, as in the CSS syntax specification.
 */
function decodeCssEscapes(css: string): string {
  return css
    .replace(
      /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-fA-F]))|\\[\n\r\f]/g,
      (_m, hex?: string, ch?: string) => {
        if (!hex) return ch ?? "";
        const cp = Number.parseInt(hex, 16);
        return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\ufffd" : String.fromCodePoint(cp);
      },
    )
    .replace(/\\/g, "");
}

/**
 * Makes style text fetch nothing from the network: removes `@import`, and turns every `url(` that is
 * not a data or blob URL, every `image-set(` and `src(` (they accept bare URL strings) and `expression(`
 * into an invalid function. Escapes are decoded first. Also covers text a renderer spliced untrusted
 * names into (docx-preview copies font names into style sheets unescaped).
 */
export function sanitizeCss(css: string): string {
  // A space, not "": deleting the inner rule of `@imp@import "a";ort "https://…"` would join a new @import.
  return decodeCssEscapes(css)
    .replace(/@import\b[^;]*;?/gi, " ")
    .replace(/url\s*\((?!\s*['"]?\s*(?:data:|blob:))/gi, "invalid(")
    .replace(/(?:-webkit-)?image-set\s*\(|\bsrc\s*\(|expression\s*\(/gi, "invalid(");
}
