# @swarmloom/adapter-odf

The OpenDocument adapter for SwarmLoom. It turns text documents (ODT), spreadsheets (ODS), presentations (ODP) and drawings (ODG), packaged or flat XML (`.fodt`, `.fods`, `.fodp`, `.fodg`), into page or slide sheets that the swarm weaves. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { odfAdapter } from "@swarmloom/adapter-odf";

const { blueprint, notes, dispose } = await odfAdapter.load({ bytes }, { document, width: 960, theme: "light" });
```

How it works:

- The ZIP package is read with limits: at most 10 000 entries, 512 MiB unpacked in total, 128 MiB per entry and a 200:1 ratio for entries over 64 KiB. Names with `..` or an absolute path are rejected. A `META-INF/manifest.xml` with `encryption-data` is rejected as encrypted. XML with a DOCTYPE or entity declarations is rejected.
- `styles.xml` and the automatic styles of `content.xml` are resolved through their parent chains into CSS: fonts, sizes, weights, colours, highlights, alignment, margins, indents, borders, cell fills and column widths.
- Text documents: paragraphs, headings, lists, tables (with spans), frames with images, links (as styled text), tabs, line breaks and page breaks become HTML on A4-like sheets.
- Spreadsheets: each sheet becomes a grid of cached cell values with column widths, bold, fills and merged cells. Formulas are not recalculated. Grids are cut at 40 columns and 200 rows.
- Presentations and drawings: each page becomes a slide with its master-page background and frames (empty placeholder prompts are left out), then its own positioned frames, text boxes, images and basic shapes (rectangles, ellipses, lines, custom shapes with an `svg:d` path), including rotation and `draw:transform`.
- Images from the package become blob URLs, revoked by `dispose()`. Charts, formulas and OLE objects are shown as labelled placeholders.
- The HTML is laid out with `@swarmloom/snapshot-dom`, which turns it into a blueprint. Sheets get the `page` role (`slide` for presentations).

Fonts follow the shared fallback table (decision F01, `FONT_FALLBACKS` in `@swarmloom/core`): Calibri falls back to Carlito, Arial to Liberation Sans, SimSun to Noto Serif SC, and so on. Fonts are only requested with `local()`, never downloaded. Every substitution of a font missing on the device is reported in `notes` (an installed original is not), together with other quality notes such as placeholders and cut tables.

Options (`createOdfAdapter`): `maxBytes` (100 MiB), `budget` (S10 long-input budget, default 420 units or 12 000 characters), `maxSlides` (20), `snapshotHtml` (to replace the snapshot implementation, mainly for tests). When the budget runs out, the rest is left out and counted in `blueprint.truncated`.

The shared toolkit used by the EPUB, RTF and OFD adapters is exported as `@swarmloom/adapter-odf/kit`: the safe ZIP and XML readers, F01 font stacks over the core table (`fontStack`, `FontReport`), the content budget, HTML helpers, image sniffing and the page-sheet layout.

Limits: no formula recalculation, conditional formats or charts (charts are placeholders); gradients and hatches are simplified to flat fills; 3D scenes are not drawn; animations and transitions are not played.

License: MIT.
