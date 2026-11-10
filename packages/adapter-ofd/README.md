# @swarmloom/adapter-ofd

The OFD adapter for SwarmLoom. It reads Open Fixed-layout Documents (GB/T 33190, common for Chinese e-invoices and official documents) and redraws each page as positioned HTML and SVG for the swarm to weave. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { ofdAdapter } from "@swarmloom/adapter-ofd";

const { blueprint, notes, dispose } = await ofdAdapter.load({ bytes }, { document, width: 960, theme: "light" });
```

How it works:

- The ZIP package is read with the same limits as the ODF adapter. `OFD.xml` points to the first `Document.xml`, which lists the pages, the template pages, the page areas and the public and document resources (fonts, colour spaces, multimedia).
- Each page's `Content.xml` is drawn in millimetres converted to CSS pixels (96 / 25.4 px per mm), template pages first:
  - `TextObject`: each `TextCode` run is placed glyph by glyph from `X`/`Y`, `DeltaX` and `DeltaY`, including the `g N v` repeat form, with size, weight, italic, fill colour and the object's `CTM`.
  - `PathObject`: `AbbreviatedData` (`S`/`M` move, `L` line, `Q` quadratic, `B` cubic, `A` arc, `C` close) becomes an SVG path with stroke, fill, line width, caps, joins, dashes and the even-odd rule.
  - `ImageObject`: the `MultiMedia` resource becomes a blob URL, which `dispose()` revokes.
  - `PageBlock` groups are followed; at most 4000 objects are drawn per page.
- The HTML is laid out with `@swarmloom/snapshot-dom`, and each page gets the `page` role.

Fonts follow the shared F01 fallback table from `@swarmloom/adapter-odf/kit` (SimSun and KaiTi fall back to Noto Serif SC, SimHei to Noto Sans SC, Courier New to Liberation Mono). Embedded font files are not loaded. Substitutions, signatures, annotations and skipped objects are listed in `notes`.

Options (`createOfdAdapter`): `maxBytes` (100 MiB), `budget` (S10 long-input budget, default 420 units or 12 000 characters), `maxPages` (10), `snapshotHtml`.

Limits: composite objects, annotations, clip regions, shadings and patterns are not drawn. Signatures are neither verified nor drawn. Embedded fonts are replaced by fallbacks, so glyph positions are exact but glyph shapes may differ.

License: MIT.
