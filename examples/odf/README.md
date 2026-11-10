# OpenDocument samples

Three small OpenDocument files written for this repository. They are the fixtures of the `@swarmloom/adapter-odf` tests and the ODF demos:

| File | Size | Covers |
|---|---|---|
| `report.odt` | about 8 KB | headings, styled paragraphs, a bulleted and a numbered list, a table with a merged header and cell fills, an inline picture, a page break and a line of Chinese text in SimSun (font fallback) |
| `budget.ods` | about 3 KB | two sheets, cached numbers and `SUM` formulas, column widths, a bold header row with a fill, and a merged title cell |
| `deck.odp` | about 8 KB | two slides on a master page with a title placeholder, positioned text boxes in English and Chinese, a picture, custom shapes (ellipse, triangle, rounded rectangle), a line and a rectangle rotated with `draw:transform` |

`generate.mjs` writes all three from scratch. The XML is in the script, and `pack.mjs` packs it as ODF 1.3 requires (`mimetype` first and stored) with fixed timestamps, so the output is byte-for-byte reproducible:

```sh
node examples/odf/generate.mjs [--out dir]
```

`pack.mjs` also draws the woven-thread PNG used as the picture in every sample. It is shared by the EPUB, RTF and OFD generators. Each script fails if a file reaches 200 KB.

The text, data and artwork are original. License: MIT.
