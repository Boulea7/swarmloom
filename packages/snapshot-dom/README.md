# @swarmloom/snapshot-dom

Captures a live DOM tree, either a whole document or any element subtree, as a SwarmLoom `Blueprint`: styled boxes, text blocks, vector paths, images, media placeholders and snap guides with their dependencies. It also exports `domAdapter` (id `dom`), and document-style adapters reuse it after rendering their input into a hidden sandbox.

```ts
import { snapshot, snapshotHtml } from "@swarmloom/snapshot-dom";

// A live page: world origin = document origin, fixed UI captured once as screen content.
const page = await snapshot(document, { prescroll: true });

// An HTML fragment laid out off-screen at a fixed width, top-left at (0,0).
const doc = await snapshotHtml("<h1>Notes</h1><p>Hello</p>", { width: 720, css: ".sl-root{padding:32px}" });
```

How it works:

- One read pass over the flat tree: open shadow roots, slots, `display: contents` and same-origin iframes are followed. Computed styles and rects are read once per element and cached, and nothing is written during the walk, so layout is never thrashed. Closed `<details>`, `display: none`, near-zero opacity, visually hidden helper text and `content-visibility: hidden` content are skipped.
- The walk runs in slices of about 10 ms, so the page stays responsive and `signal` aborts within one slice; if the page or the user scrolls in between, the scroll position is put back. Subtrees that start below `maxHeight`, and everything after about twice `maxLayers` layers, are only skimmed for fixed and absolutely positioned content, so a long page costs about as much as the part that is kept.
- Painted elements become box layers (fills, gradients, images, borders, radii, shadows, outlines, backdrop filters, masks). Single-side borders and `<hr>` become path layers.
- Inline content becomes one text layer per block, with formatting kept as sanitised HTML with inline styles (fonts, colours, links, code spans, inline icons, inline `::before`/`::after`, list markers). Text next to controls emitted on their own (checkboxes, buttons) keeps its position. Absolutely positioned pseudo-elements become their own layers. First baselines are recorded for guides.
- `img` (also inside `picture`), `svg` and readable `canvas` elements become image layers. Inline SVG is serialised with its computed styles, ids prefixed and `use` inlined; safe SMIL animation is kept and flagged with `meta.smil` so the stage can replay it. Video, WebGL canvases, cross-origin iframes and `data-swarmloom-media` elements become labelled media placeholders, cropped from `opts.screenshot` when it covers them.
- Form controls become boxes plus text. Passwords, card numbers and one-time codes are always masked; other typed values are masked unless `showFormValues` is set.
- An app-shell scroller (the document does not scroll, one large inner element does) is unrolled into world coordinates with its clip. Fixed elements and open modal dialogs, popovers and fullscreen elements (with their `::backdrop`) are captured once where they sit at the top and are kept when layers are truncated. Stuck sticky elements are moved back to their place in the flow.
- Repeated siblings with the same structure and similar size and classes (nav links, cards, rows, logo strips) are marked as duplicates (`master`). Shared left edges and first baselines across at least three text blocks become guide layers with `snaps`.
- Paint order follows stacking contexts. Beyond `maxLayers` the far content is dropped first (fixed UI and the capture viewport stay) and `truncated` says why.

`snapshotHtml` sanitises the fragment (no scripts, handlers, frames or script URLs), mounts it in an inert open shadow root off-screen at `width`, waits up to 3 s for fonts and images, snapshots it with origin `element` and always removes the sandbox, also on abort or failure.

Options (`SnapshotOptions`): `origin`, `source`, `maxLayers` (6000), `maxHeight` (60 000 px), `detectDuplicates` (true), `detectGuides` (true), `screenshot`, `prescroll` (false: up to 16 steps or 2.5 s, scroll position restored), `inlineImages` (false: same-origin and blob images become data URLs), `showFormValues` (false), `signal`. `snapshotHtml` adds `width`, `css`, `document`, `baseUrl`, `background`, `scheme` and `icon`. Invalid options reject with a `TypeError` or `RangeError`.

Limits: closed shadow roots and cross-origin frames are placeholders. 3D transforms keep only their 2D part. Text in transformed subtrees is not used for baseline guides. CSS animations are captured as they are at capture time; callers that need a fixed pose (such as the HTML adapter) settle them before calling. The edge-case page used by the browser tests is `examples/web/demo.html`.

License: MIT.
