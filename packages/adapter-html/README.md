# @swarmloom/adapter-html

The HTML adapter for SwarmLoom (id `html`). It accepts text, a URL or bytes (the charset comes from the BOM or `<meta charset>`).

```ts
import { createHtmlAdapter } from "@swarmloom/adapter-html";

const html = createHtmlAdapter({ network: "https", keepLive: true });
const { blueprint, warnings, live } = await html.load({ url: "https://example.com/" }, ctx);
```

- **Full documents** (`<!doctype>`, `<html>`, `<head>` or `<body>`) are sanitized, written into a hidden `<iframe sandbox="allow-same-origin" srcdoc>` with a strict CSP, laid out at `ctx.width` and captured with `snapshot(frame.contentDocument, { origin: "document" })`.
- **Fragments** are sanitized and captured with `snapshotHtml` on a plain page in the current theme.

CSS animations and transitions are posed before the capture: finite ones at their end state, infinite ones at half a cycle (`infinitePhase`). The ones that pose sets off (an em-based size, a container query that now matches) are posed the same way. With `keepLive`, the frame is returned as `live` and `live.resume()` lets the animations play again on go live; `dispose()` removes it.

Keyframe timeline: when the load context carries an `anim:timeline` plugin (`ctx.plugins`, type `HtmlLoadContext`; the plugin comes from `@swarmloom/adapter-lottie` and is looked up by name, not imported), up to six animated elements of a full document get an `anim:timeline` layer (`duration`, `keyframes` and `rest`, the captured pose) in free space under or above them, built after the page and before go live. A bar never covers page content; an element without free space gets none. Without the plugin nothing changes.

Safe defaults:

- Scripts never run. Script tags, event handlers and `javascript:` URLs are removed, and a page that had scripts gets a warning that it is shown as written.
- Network: `network: "https"` (default) allows `https:` images and fonts, sent without a referrer. `network: "none"` allows only `data:` and `blob:` ones. A host can also pass `network: "none"` in the load context (`HtmlLoadContext`) to turn remote loading off for one load; the stricter policy wins. Under either policy, images and fonts from the origin of a plain-`http:` `baseUrl` on a loopback host (`localhost`, `127.0.0.0/8`, `[::1]`: the local server the document came from, such as the CLI's) load too; other plain-`http:` URLs, a remote `http:` `baseUrl` included, never do. External style sheets, `@import`, media, frames, objects, forms and `connect` are always blocked. The CSP is `default-src 'none'; img-src data: blob: https:; font-src data: blob: https:; ...` (without `https:` under `"none"`, plus that local origin).
- Relative URLs resolve against `baseUrl` (default: the input URL), moved by the document's own `<base href>` if it has one. That `<base>` never makes another plain-`http:` host local.
- Limits: 8 MiB of input (`maxBytes`), 60 000 elements (`maxElements`), 10 s for the page and its resources (`loadTimeoutMs`). Errors name the limit that was hit.

Skipped resources and timeouts are reported in `warnings`.

License: MIT. DOMPurify is used under Apache-2.0.
