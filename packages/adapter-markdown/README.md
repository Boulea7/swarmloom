# @swarmloom/adapter-markdown

The Markdown adapter for SwarmLoom (id `markdown`). It turns CommonMark + GFM into a themed, sanitized HTML page and snapshots it into a `Blueprint` with `heading`, `paragraph`, `list-item`, `code`, `table` and `quote` layers.

```ts
import { createMarkdownAdapter, markdownAdapter } from "@swarmloom/adapter-markdown";

const { blueprint, warnings } = await markdownAdapter.load({ name: "README.md", text }, ctx);
```

Pipeline: `parseMarkdown` (remark + GFM + math) -> `renderMdast` (HTML) -> `markdownToHtml` (DOMPurify plus the Loom light/dark theme from `loomThemeCss`: 720px measure, CJK font stacks) -> `snapshotHtml(width = clamp(ctx.width, 360, 920))`. These helpers, along with `assetPath` and `imageSource`, are exported for tests and tools and need no layout. adapter-notebook renders its Markdown cells with `parseMarkdown` and `renderMdast`, passing its own highlighter through the optional `renderCode` hook.

Supported: tables, task lists, strikethrough, autolinks, footnotes, heading anchors, front-matter titles, GitHub alerts (`> [!NOTE]` and friends), common raw HTML from READMEs (`<p align="center">`, `<img width>`, `<picture>`), and code highlighted by the shared highlighter from `@swarmloom/adapter-code`. `$...$` and `$$...$$` math is rendered with KaTeX, which is only loaded when a document has formulas; its markup is marked `data-swarmloom-verbatim` so the snapshot keeps it and the KaTeX style sheet in `Blueprint.css` lays it out on the stage; amounts such as `$5 and $6` stay text. ` ```mermaid ` fences go to the `renderDiagram` hook when one is given and are shown as code otherwise.

Safe defaults:

- Raw HTML is always sanitized (no scripts, handlers, forms or frames).
- Images: `data:`, `blob:` and `https:` are kept; `http:` is refused unless it is the loopback origin of a plain-http `baseUrl` (the CLI's local server for the input folder). `//host/a`, and the `\\host/a` and `/\host/a` forms browsers read the same way, count as `https://host/a`, except on the loopback origin of a plain-http `baseUrl`, where they stay that local `http:` URL. `remoteImages: false` turns remote images off, and so does `network: "none"` in the load context (`MarkdownLoadContext`). `srcset` is dropped so only the checked `src` loads. `<img>`, Markdown images included, gets `referrerpolicy="no-referrer"`.
- The same rules cover every other image reference in raw HTML (`poster`, SVG `<image>` and `<feImage>`, `background` attributes, CSS `url()` in style attributes, through adapter-html's `rewriteCssUrls`); video and audio files, `<source>` and `<track>` are never loaded. These references cannot carry a referrer policy of their own, so they follow the host page's: by default the browser sends the page's origin. The Studio (`<meta name="referrer" content="no-referrer">`) and the CLI (which drops the `Referer` header) send none; another host that turns remote images on should set the same policy.
- Relative images resolve against `baseUrl` (default: the input URL) or through `resolveAsset(path)`, for files dropped together with the document (folder or zip).
- Sources over 4 MiB are rejected (`maxBytes`).

Every skipped image or failed font is listed in `warnings`.

License: MIT. KaTeX (MIT) and DOMPurify (used under Apache-2.0) are bundled dependencies.
