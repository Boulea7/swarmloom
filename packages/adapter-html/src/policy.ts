/**
 * Remote subresources HTML input may load:
 *  - "https": images and fonts from any https: URL, fetched without a referrer (the default in
 *    the Studio and the CLI; a setting can turn it off). Nothing else leaves the machine.
 *  - "none": only data: and blob: URLs.
 * Style sheets, scripts, media, frames and connections are never fetched from the network.
 */
export type NetworkPolicy = "https" | "none";

/** CSP source list for images and fonts under a policy. */
export function sourceList(policy: NetworkPolicy): string {
  return policy === "https" ? "data: blob: https:" : "data: blob:";
}

const DATA_IMAGE = /^data:image\/(?:png|gif|jpeg|webp|avif|svg\+xml|bmp|x-icon)[;,]/i;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
/** Placeholder for refused CSS URLs: an empty data: URL, so no request is made and the syntax stays valid. */
const EMPTY_URL = 'url("data:,")';

function resolve(url: string, base: string | undefined): URL | undefined {
  try {
    return new URL(url.trim(), base);
  } catch {
    return undefined;
  }
}

/**
 * The URL an image or font reference may load under a policy (absolute), or undefined when it is
 * refused. Relative references resolve against `base`; without a base they are refused, because
 * they would otherwise hit the host page's own server.
 */
export function allowedResource(
  url: string,
  policy: NetworkPolicy,
  base?: string,
  kind: "image" | "font" = "image",
): string | undefined {
  const v = url.trim();
  if (!v) return undefined;
  if (/^data:/i.test(v)) return kind === "font" || DATA_IMAGE.test(v) ? v : undefined;
  if (/^blob:/i.test(v)) return v;
  const u = resolve(v, base);
  if (!u) return undefined;
  return u.protocol === "https:" && policy === "https" ? u.href : undefined;
}

/** Rewrites `url()` references in CSS text: allowed ones become absolute, others an empty data: URL. */
export function rewriteCssUrls(css: string, policy: NetworkPolicy, base?: string): string {
  if (!/url\(/i.test(css)) return css;
  return css.replace(CSS_URL, (_whole, dq?: string, sq?: string, bare?: string) => {
    const raw = dq ?? sq ?? bare ?? "";
    if (raw.startsWith("#")) return `url("${raw}")`;
    // A font cannot be told apart from an image here; data: URLs of either kind are local.
    const ok = /^data:/i.test(raw.trim()) ? raw.trim() : allowedResource(raw, policy, base);
    return ok ? `url("${ok.replace(/"/g, "%22")}")` : EMPTY_URL;
  });
}

/**
 * Applies the network policy to sanitized markup that is laid out without a CSP of its own
 * (fragments go into the host document): image sources are resolved or removed, `srcset`,
 * `<source>`, media sources and external style sheets are dropped, and `url()` in style
 * attributes and `<style>` elements is rewritten. Returns how many references were refused.
 */
export function applyNetworkPolicy(root: ParentNode, policy: NetworkPolicy, base?: string): number {
  let refused = 0;
  for (const el of Array.from(root.querySelectorAll("source, track"))) {
    el.remove();
    refused++;
  }
  for (const el of Array.from(root.querySelectorAll("link"))) {
    const href = el.getAttribute("href") ?? "";
    if (!/^(?:data|blob):/i.test(href.trim())) {
      el.remove();
      refused++;
    }
  }
  for (const el of Array.from(root.querySelectorAll("img, image, video, audio, input[type=image]"))) {
    el.removeAttribute("srcset");
    el.removeAttribute("sizes");
    for (const attr of ["src", "poster", "href", "xlink:href"]) {
      const value = el.getAttribute(attr);
      if (value === null || value.startsWith("#")) continue;
      const media = el.localName === "video" || el.localName === "audio";
      const ok = media && attr === "src" ? undefined : allowedResource(value, policy, base);
      if (ok) el.setAttribute(attr, ok);
      else {
        el.removeAttribute(attr);
        refused++;
      }
    }
    if (el.localName === "img") el.setAttribute("referrerpolicy", "no-referrer");
  }
  for (const el of Array.from(root.querySelectorAll("[style]"))) {
    const style = el.getAttribute("style") ?? "";
    const next = rewriteCssUrls(style, policy, base);
    if (next !== style) el.setAttribute("style", next);
  }
  for (const el of Array.from(root.querySelectorAll("style"))) {
    const css = el.textContent ?? "";
    const next = rewriteCssUrls(css.replace(/@import\b[^;]*;?/gi, ""), policy, base);
    if (next !== css) el.textContent = next;
  }
  return refused;
}
