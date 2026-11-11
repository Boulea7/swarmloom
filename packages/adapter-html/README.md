# @swarmloom/adapter-html

The HTML adapter for SwarmLoom (id `html`). It accepts text, a URL or bytes (the charset comes from the BOM or `<meta charset>`).

```ts
import { createHtmlAdapter } from "@swarmloom/adapter-html";

const html = createHtmlAdapter({ network: "https", keepLive: true });
const { blueprint, warnings, live } = await html.load({ url: "https://example.com/" }, ctx);
```

- **Full documents** (`<!doctype>`, `<html>`, `<head>` or `<body>`) are sanitized, written into a hidden `<iframe sandbox="allow-same-origin" srcdoc>` with a strict CSP, laid out at `ctx.width` and captured with `snapshot(frame.contentDocument, { origin: "document" })`.
- **Fragments** are sanitized and captured with `snapshotHtml` on a plain page in the current theme.

CSS animations are posed before the capture: finite ones at their end state, infinite ones at half a cycle (`infinitePhase`). With `keepLive`, the frame is returned as `live` and `live.resume()` lets the animations play again on go live; `dispose()` removes it.

Safe defaults:

- Scripts never run. Script tags, event handlers and `javascript:` URLs are removed, and a page that had scripts gets a warning that it is shown as written.
- Network: `network: "https"` (default) allows only `https:` images and fonts, sent without a referrer. `network: "none"` loads nothing remote. A host can also pass `network: "none"` in the load context (`HtmlLoadContext`) to turn remote loading off for one load; the stricter policy wins. External style sheets, `@import`, media, frames, objects, forms and `connect` are always blocked. The CSP is `default-src 'none'; img-src https: blob: data:; font-src https: blob: data:; ...`.
- Relative URLs resolve against `baseUrl` (default: the input URL).
- Limits: 8 MiB of input (`maxBytes`), 60 000 elements (`maxElements`), 10 s for the page and its resources (`loadTimeoutMs`). Errors name the limit that was hit.

Skipped resources and timeouts are reported in `warnings`.

License: MIT. DOMPurify is used under Apache-2.0.
