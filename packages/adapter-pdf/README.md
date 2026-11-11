# @swarmloom/adapter-pdf

The PDF adapter for SwarmLoom. It turns a PDF into a blueprint of page sheets that the swarm rebuilds
line by line, figure by figure. Every page is rendered once by [pdf.js](https://github.com/mozilla/pdf.js)
(`pdfjs-dist`, Apache-2.0), and every layer reveals a piece of that one bitmap, so the finished frame
matches the PDF pixel for pixel. Load it through `@swarmloom/formats` so pdf.js is only fetched when a PDF
is opened.

```ts
import { pdfAdapter } from "@swarmloom/adapter-pdf";

const source = await pdfAdapter.load({ bytes }, { document, width: 960, theme: "light" });
// source.blueprint -> stage; call source.dispose() when the stage lets go of it.
```

## What the blueprint contains

For each page (up to `maxPages`, default 30) the adapter emits:

| Layer | Kind | Reveal | Notes |
| --- | --- | --- | --- |
| `p{n}` | box, role `page` | (box) | Paper-coloured sheet with a soft shadow. Pages stack vertically with gaps, centred, scaled so the widest fits `ctx.width` (at most `maxPageWidth`, default 920 px). |
| `p{n}-t{i}` | image crop | `type` (`sweep` when rotated) | One per text line. Role `heading` or `paragraph` from the font size against the body size of the document. `meta`: `text`, `block` (`p{n}-b{k}`, one id per paragraph), `fontSize`, `dir: "rtl"` for right-to-left lines. |
| `p{n}-v{i}` | path | `pen` or `trace` | Cheap vector paths (rules, table lines, chart marks), merged by style. |
| `p{n}-f{i}` | image crop | `sweep` | Images, shadings, patterned or soft-masked paint, complex paths. |
| `p{n}-k{i}` | image crop | `sweep` | Ink nothing else covers (outlined text, annotation appearances). |

`priority` follows the content stream, so a page builds in reading order (two-column text builds column
by column, a figure appears where the text reaches it). Links and other annotations are not interactive.
Pages past `maxPages`, or pages that fail to render after the first one, are reported in
`Blueprint.truncated`.

The pipeline per page: render at `min(devicePixelRatio, 2)` (capped at `maxPagePixels` and 8192 px per
side), read text items and the operator list in parallel, group items into lines and blocks, walk the
operators for image, path and paint regions, then scan a downsampled copy of the bitmap so that invisible
shapes are dropped and any ink without a layer still gets one. Crops that overlap text read from a second
bitmap with the text cleared, so nothing appears twice.

## Options

`createPdfAdapter(options)` returns an adapter with its own options; `configurePdfAdapter(options)` sets
defaults for every adapter, including the shared `pdfAdapter`. Invalid values throw a `RangeError`.

| Option | Default | Meaning |
| --- | --- | --- |
| `maxPages` | 30 | Pages loaded from the start; the rest are reported as truncated. |
| `maxPageWidth` | 920 | Widest page in CSS px. |
| `pixelRatio` | `min(devicePixelRatio, 2)` | Device pixels per CSS px of the page bitmaps. |
| `maxPagePixels` | 5,000,000 | Larger pages render at a lower ratio. |
| `maxBytes` | 64 MiB | Largest accepted file. |
| `renderTimeoutMs` | 20000 | A slower page ends the document at the previous page. |
| `urlType` | `"blob"` | `"blob"` object URLs (revoked by `dispose()`), or `"data"` URLs that survive serialization. A data URL is repeated in every layer of its page, so a saved blueprint grows by roughly layers x bitmap size. |
| `build` | `"auto"` | `"modern"` or `"legacy"` pdf.js; auto picks legacy when the browser lacks the built-ins the modern build needs. Where `Promise.withResolvers` is missing (Chrome/Edge 116-118, Safari before 17.4) the adapter adds it and parses on the main thread. |
| `workerSrc` | bundler URL | URL of `pdf.worker.min.mjs` of the same version and build. |
| `workerPort` | - | A caller-owned pdf.js worker (never terminated by the adapter). |
| `disableWorker` | `false` | Parse on the main thread. |
| `cMapUrl`, `standardFontDataUrl`, `wasmUrl` | - | Base URLs (trailing slash) of the pdfjs-dist `cmaps/`, `standard_fonts/` and `wasm/` folders. Needed for CJK PDFs with non-embedded fonts, PDFs relying on the 14 standard fonts, and JPEG 2000 / JBIG2 images. |
| `password` | - | Password of an encrypted PDF. |

## Worker

By default the worker URL comes from `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`,
which Vite, webpack 5 and Parcel turn into an emitted asset. When that URL is missing or the worker does
not start (bundlers that leave the URL alone, a CSP without `worker-src`, a pre-bundled dev dependency),
the adapter imports the worker module and runs pdf.js on the main thread instead. Environments with
their own copy pin it:

```ts
configurePdfAdapter({
  workerSrc: chrome.runtime.getURL("pdfjs/pdf.worker.min.mjs"),
  cMapUrl: chrome.runtime.getURL("pdfjs/cmaps/"),
  standardFontDataUrl: chrome.runtime.getURL("pdfjs/standard_fonts/"),
  wasmUrl: chrome.runtime.getURL("pdfjs/wasm/"),
});
```

## Errors and memory

`load()` rejects with a `PdfAdapterError` whose `code` is `input` (no bytes, or not a PDF), `too-large`,
`invalid` (pdf.js cannot parse it), `password` or `render`. An aborted `ctx.signal` rejects with an
`AbortError` and cancels pdf.js. The pdf.js document is destroyed as soon as the blueprint is built;
the page bitmaps stay alive as PNG blobs until `dispose()` revokes them.

License: MIT. pdf.js is Apache-2.0.
