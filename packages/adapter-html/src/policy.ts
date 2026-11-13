/**
 * Remote subresources HTML input may load:
 *  - "https": images and fonts from any https: URL, fetched without a referrer (the default in
 *    the Studio and the CLI; a setting can turn it off). Nothing else leaves the machine.
 *  - "none": only data: and blob: URLs.
 * Under both, images and fonts on the {@link localOrigin} of the caller's base URL load too. That
 * origin comes from the caller only, never from a `<base href>` in the document: the document must
 * not pick a plain-http host the reader's browser then contacts.
 * Style sheets, scripts, media, frames and connections are never fetched from the network.
 */
export type NetworkPolicy = "https" | "none";

/** Loopback host names as the URL parser writes them: `localhost`, 127.0.0.0/8 and `[::1]`. */
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Origin of a plain `http:` base URL given by the caller when its host is loopback: the local
 * server the document itself came from, such as the CLI's, which publishes the images and fonts
 * next to a local input file. Its images and fonts never leave the machine. Undefined for any other
 * base: a remote http origin is not local, so `network: "none"` still refuses it.
 */
export function localOrigin(base: string | undefined): string | undefined {
  if (!base) return undefined;
  try {
    const u = new URL(base);
    return u.protocol === "http:" && LOOPBACK_HOST.test(u.hostname) ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** CSP source list for images and fonts under a policy, with the {@link localOrigin} of the caller's `base`. */
export function sourceList(policy: NetworkPolicy, base?: string): string {
  const local = localOrigin(base);
  return `${policy === "https" ? "data: blob: https:" : "data: blob:"}${local ? ` ${local}` : ""}`;
}

const DATA_IMAGE = /^data:image\/(?:png|gif|jpeg|webp|avif|svg\+xml|bmp|x-icon)[;,]/i;
/** Placeholder for refused CSS URLs: an empty data: URL, so no request is made and the syntax stays valid. */
const EMPTY_URL = 'url("data:,")';

/**
 * CSS tokens as far as the policy needs them, read like the browser's CSS tokenizer (on text whose
 * newlines are `\n`): a comment; a string (group 1 the quote, group 2 the body; an unterminated one
 * ends at a newline or the end); a name with escapes (group 4) after an optional `@` (group 3, an
 * at-keyword) and before an optional `(` (group 5, a function); a run of characters that never
 * matter; or any other single character. Reading tokens keeps `url(` in strings and comments from
 * counting, and escapes such as `\75rl(` or `@\69mport` from hiding a request.
 */
const CSS_TOKEN =
  /\/\*[\s\S]*?(?:\*\/|$)|(["'])((?:(?!\1)[^\\\n]|\\[\s\S])*)(?:\1|\\?$|(?=\n))|(@?)((?:[\w-]|[\x80-\uffff]|\\(?:[0-9a-f]{1,6}[ \t\n]?|[^\n0-9a-f]))+)(\(?)|[^"'/@\\();{}\w\x80-\uffff-]+|[\s\S]/giy;
/**
 * What follows `url(` when the browser reads a URL from it: a string (groups 1 and 2) or an unquoted
 * URL (group 3), then `)` or the end of the text (an unclosed `url(` at the end still loads).
 */
const CSS_URL_REST =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: an unquoted URL ends at a control character, as in the CSS tokenizer.
  /[ \t\n]*(?:(["'])((?:(?!\1)[^\\\n]|\\[\s\S])*)(?:\1|\\?$|(?=\n))|((?:[^\x00-\x20"'()\\\x7f]|\\[^\n])*))[ \t\n]*(?:\)|$)/y;
/** Functions that take a plain string as an image URL, as in `image-set("a.png" 1x)`. */
const URL_STRING_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "image", "src"]);
/**
 * Functions an image function may hold directly that never compute one of its URL strings: image
 * functions, `type()`, gradients, colors and math. Any other function there (`var()`, `env()`,
 * `attr()`, `if()`, a custom `--fn()`) can put a string in place when the browser computes the
 * value, after this check, so the image function around it is refused whole.
 */
const IMAGE_ARGUMENT_FUNCTION =
  /^(?:(?:-webkit-)?(?:image-set|(?:repeating-)?(?:linear|radial|conic)-gradient)|image|src|type|rgba?|hsla?|hwb|(?:ok)?(?:lab|lch)|color(?:-mix)?|calc|min|max|clamp)$/;
/** SVG presentation attributes the browser reads as CSS, where a `url()` can name another document. */
const CSS_ATTRIBUTES = [
  "style",
  "fill",
  "stroke",
  "filter",
  "mask",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
];

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
 * they would otherwise hit the host page's own server. `http:` URLs load only from `local`, the
 * {@link localOrigin} of the caller's base (not derived from `base`, which a document can set).
 */
export function allowedResource(
  url: string,
  policy: NetworkPolicy,
  base?: string,
  kind: "image" | "font" = "image",
  local?: string,
): string | undefined {
  const v = url.trim();
  if (!v) return undefined;
  if (/^data:/i.test(v)) return kind === "font" || DATA_IMAGE.test(v) ? v : undefined;
  if (/^blob:/i.test(v)) return v;
  const u = resolve(v, base);
  if (!u) return undefined;
  if (u.protocol === "http:") return local !== undefined && u.origin === local ? u.href : undefined;
  return u.protocol === "https:" && policy === "https" ? u.href : undefined;
}

/**
 * Decodes CSS escapes as the tokenizer does (on text whose newlines are `\n`): `\75 ` and `\u` are
 * `u`, and a backslash before a newline is dropped. Invalid code points become U+FFFD.
 */
function decodeCssEscapes(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|([\s\S]))/gi, (_m, hex?: string, ch?: string) => {
    if (hex === undefined) return ch === "\n" ? "" : (ch ?? "");
    const cp = Number.parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\ufffd" : String.fromCodePoint(cp);
  });
}

/**
 * `url("…")` for a URL the policy allowed. Quotes, backslashes, parentheses and angle brackets are
 * percent-encoded (tabs and newlines dropped, as the URL parser does), so the text can neither end
 * the string early nor read as markup or CSS of its own.
 */
function cssUrl(url: string): string {
  const text = url
    .replace(/[\t\n\r]/g, "")
    .replace(/[\f"'()<>\\]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`);
  return `url("${text}")`;
}

/**
 * Applies the network policy to CSS text (`<style>` content or a style attribute): every `url()`
 * and every string an image function takes as a URL (`image-set("a.png" 1x)`) becomes an absolute
 * allowed URL or an empty data: URL, `@import` rules are removed, and a `url(` the browser would
 * not read as one URL becomes `invalid(`, as does an image function holding a function that could
 * compute one of its URL strings later (`image-set(var(--a) 1x)`, not
 * `image-set(linear-gradient(var(--a),red) 1x)`). The text is read token by token like the
 * browser does, so CSS escapes (`\75rl(`, `@\69mport`) cannot hide a request; the rest of the
 * text, escapes in selectors included, is kept as written. `local` is as in {@link allowedResource}.
 */
export function rewriteCssUrls(css: string, policy: NetworkPolicy, base?: string, local?: string): string {
  if (!/[(@]/.test(css)) return css;
  // The CSS tokenizer turns CRLF, CR and FF into LF first; the patterns then need one newline.
  const text = css.replace(/\r\n?|\f/g, "\n");
  const url = (value: string): string => {
    const v = decodeCssEscapes(value).trim();
    // A font cannot be told apart from an image here; data: URLs of either kind are local.
    const ok = v.startsWith("#") || /^data:/i.test(v) ? v : allowedResource(v, policy, base, "image", local);
    return ok ? cssUrl(ok) : EMPTY_URL;
  };
  const token = new RegExp(CSS_TOKEN);
  const rest = new RegExp(CSS_URL_REST);
  const out: string[] = [];
  // One entry per open parenthesis: for a function that takes strings as image URLs, the index of
  // its name in `out`; -1 for any other parenthesis.
  const parens: number[] = [];
  // How many entries of `parens` are image functions, and the outermost one's index in `out`. Kept
  // on push and pop so a deeply nested value costs linear time, not a scan of `parens` per function.
  let images = 0;
  let outerImage = -1;
  const open = (image: number): void => {
    parens.push(image);
    if (image < 0) return;
    if (images++ === 0) outerImage = image;
  };
  const close = (): void => {
    const image = parens.pop();
    if (image !== undefined && image >= 0 && --images === 0) outerImage = -1;
  };
  // Parenthesis depth of the `@import` rule being removed, or -1.
  let dropDepth = -1;
  for (let at = 0; at < text.length; ) {
    token.lastIndex = at;
    // Always matches: the last alternative takes any single character.
    const m = token.exec(text) as RegExpExecArray;
    at = token.lastIndex;
    const [tok, quote, body, atSign, name, paren] = m;
    const dropping = dropDepth >= 0;
    let emit = tok;
    if (quote !== undefined) {
      if ((parens.at(-1) ?? -1) >= 0) emit = url(body ?? "");
    } else if (name !== undefined) {
      const id = decodeCssEscapes(name).toLowerCase();
      if (atSign && id === "import") {
        dropDepth = parens.length;
        // A space, not "": `@imp@import "a";ort "…"` must not join into a new @import.
        emit = " ";
      }
      if (paren && !atSign && id === "url") {
        rest.lastIndex = at;
        const u = rest.exec(text);
        if (u) {
          at = rest.lastIndex;
          emit = url(u[2] ?? u[3] ?? "");
        } else {
          emit = "invalid(";
          open(-1);
        }
      } else if (paren) {
        // Only a function written right where an image function reads URL strings can put one
        // there: deeper down, in a gradient or a color, what var() and the like put in has balanced
        // parentheses, so it stays among that function's own arguments.
        const urlStrings = (parens.at(-1) ?? -1) >= 0;
        if (urlStrings && !atSign && !IMAGE_ARGUMENT_FUNCTION.test(id)) out[outerImage] = "invalid(";
        // Inside a removed @import nothing is written, so there is no name to refuse later.
        open(!atSign && !dropping && URL_STRING_FUNCTIONS.has(id) ? out.length : -1);
      }
    } else if (tok === "(") open(-1);
    else if (tok === ")") close();
    if (dropping) {
      // The rule ends at its `;` (removed with it), at a brace, or where its enclosing `(` closes.
      const end = parens.length < dropDepth || (parens.length === dropDepth && /^[;{}]$/.test(tok));
      if (end) {
        dropDepth = -1;
        if (tok !== ";") out.push(tok);
      }
      continue;
    }
    out.push(emit);
  }
  return out.join("");
}

/**
 * Applies the network policy to sanitized markup that is laid out without a CSP of its own
 * (fragments go into the host document): image sources (`<img>`, SVG `<image>` and `<feImage>`,
 * `background` attributes) are resolved or removed, `srcset`, `<source>`, media sources and
 * external style sheets are dropped, and CSS in style attributes, SVG presentation attributes and
 * `<style>` elements goes through {@link rewriteCssUrls}. References resolve against `base`;
 * plain-http ones load only from `local` (see {@link allowedResource}). Returns how many were refused.
 */
export function applyNetworkPolicy(root: ParentNode, policy: NetworkPolicy, base?: string, local?: string): number {
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
  for (const el of Array.from(root.querySelectorAll("img, image, feImage, video, audio, input[type=image]"))) {
    el.removeAttribute("srcset");
    el.removeAttribute("sizes");
    for (const attr of ["src", "poster", "href", "xlink:href"]) {
      const value = el.getAttribute(attr);
      if (value === null || value.startsWith("#")) continue;
      const media = el.localName === "video" || el.localName === "audio";
      const ok = media && attr === "src" ? undefined : allowedResource(value, policy, base, "image", local);
      if (ok) el.setAttribute(attr, ok);
      else {
        el.removeAttribute(attr);
        refused++;
      }
    }
    if (el.localName === "img") el.setAttribute("referrerpolicy", "no-referrer");
  }
  // The legacy `background` attribute of body and table cells loads an image too.
  for (const el of Array.from(root.querySelectorAll("[background]"))) {
    const ok = allowedResource(el.getAttribute("background") ?? "", policy, base, "image", local);
    if (ok) el.setAttribute("background", ok);
    else {
      el.removeAttribute("background");
      refused++;
    }
  }
  for (const name of CSS_ATTRIBUTES) {
    for (const el of Array.from(root.querySelectorAll(`[${name}]`))) {
      const value = el.getAttribute(name) ?? "";
      const next = rewriteCssUrls(value, policy, base, local);
      if (next !== value) el.setAttribute(name, next);
    }
  }
  for (const el of Array.from(root.querySelectorAll("style"))) {
    const css = el.textContent ?? "";
    const next = rewriteCssUrls(css, policy, base, local);
    if (next !== css) el.textContent = next;
  }
  return refused;
}
