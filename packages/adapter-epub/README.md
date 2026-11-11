# @swarmloom/adapter-epub

The EPUB adapter for SwarmLoom. It turns an EPUB 2 or EPUB 3 book into page sheets: the cover first, then the first chapters, each with its own (sanitized) book styles. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { epubAdapter } from "@swarmloom/adapter-epub";

const { blueprint, notes, dispose } = await epubAdapter.load({ bytes }, { document, width: 960, theme: "light" });
```

How it works:

- `META-INF/container.xml` points to the package document (OPF). Its manifest and spine give the reading order, the cover image and the table of contents (the EPUB 3 navigation document, or the EPUB 2 NCX).
- Books with encrypted content (`META-INF/encryption.xml` entries other than font obfuscation) are rejected with an `encrypted` error saying the book is DRM-protected. Obfuscated fonts are skipped and the fallback font is used.
- Each chapter is parsed as XHTML (falling back to HTML) and sanitized with DOMPurify. Scripts, forms, iframes, event handlers and remote URLs are removed. Images, SVG and fonts from the book become blob URLs, which `dispose()` revokes.
- Book style sheets are scoped to their own chapter. `@import`, `@charset` and `@namespace` are dropped, and `@font-face` rules that point inside the book are registered with the FontFace API.
- The table of contents is reported as an outline note (its first 20 entries).
- The HTML is laid out with `@swarmloom/snapshot-dom`, and every chapter sheet gets the `page` role. Fixed-layout books (`rendition:layout` set to `pre-paginated`) keep their viewport size and are zoomed out when wider than 900 px.

Options (`createEpubAdapter`): `maxBytes` (100 MiB), `budget` (S10 long-input budget, default 420 units or 12 000 characters), `maxChapters` (24), `snapshotHtml`. When the budget runs out, the remaining chapters are counted in `blueprint.truncated`.

Fonts follow the shared F01 fallback table (`FONT_FALLBACKS` in `@swarmloom/core`, through `@swarmloom/adapter-odf/kit`), and substitutions are listed in `notes`.

Limits: no scripts, media overlays or audio and video playback. Fixed-layout books are drawn one page per sheet and have not been tested against a real fixed-layout sample.

Dependencies: `fflate` (MIT) and `dompurify` (used under Apache-2.0, one of its two licence options).

License: MIT.
