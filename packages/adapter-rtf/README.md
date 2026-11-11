# @swarmloom/adapter-rtf

The Rich Text Format adapter for SwarmLoom. It has its own RTF tokenizer and parser (no dependencies), renders the result as page sheets, and exports the parser for other code. Load it through `@swarmloom/formats` so it is only fetched when needed. `@swarmloom/formats` recognises RTF by its `{\rtf` signature, so an RTF file saved with a `.doc` name opens here too. `@swarmloom/adapter-doc` does not forward such a file when called directly: it rejects it with a `DocError` (`code: "wrong-format"`, `format: "rtf"`).

```ts
import { rtfAdapter, parseRtf, renderRtf } from "@swarmloom/adapter-rtf";

const { blueprint, notes } = await rtfAdapter.load({ bytes }, { document, width: 960, theme: "light" });

// Or only the parser, for example from another adapter:
const doc = parseRtf(bytes); // blocks: paragraphs, tables and page breaks
```

The parser covers:

- groups and control words, with unbalanced groups rejected as malformed and a nesting limit;
- `\u` escapes with the `\uc` skip count, and `\'hh` bytes decoded with `TextDecoder` using the code page of the font (`\fcharset`, `\cpg`) or of the document (`\ansicpg`). This includes 936 (GBK), 950 (Big5), 932, 949 and the Windows single-byte pages;
- the font table, colour table and document info (title, author);
- character formatting (`\b \i \ul \strike \fs \f \cf \highlight \super \sub \caps`);
- paragraph formatting (`\pard \q* \li \ri \fi \sb \sa \sl`), plus `\par \line \tab \page`;
- tables (`\trowd \cellx \clcbpat \cell \row`, merged cells);
- PNG and JPEG pictures (`\pict`, hex or `\bin`).

Unknown `{\*...}` destinations, headers, footers, footnotes and comments are skipped.

The renderer turns the blocks into HTML on A4-like sheets, which are laid out with `@swarmloom/snapshot-dom`. Pictures become blob URLs, which `dispose()` revokes. EMF and WMF pictures are shown as placeholders. Fonts follow the shared F01 fallback table (`FONT_FALLBACKS` in `@swarmloom/core`, through `@swarmloom/adapter-odf/kit`), and substitutions and skipped content are listed in `notes`.

Options (`createRtfAdapter`): `maxBytes` (50 MiB), `budget` (S10 long-input budget, default 420 units or 12 000 characters), `parse` (`maxDepth` 1024, `maxPictureBytes` 16 MiB, `maxPictures` 64), `snapshotHtml`.

Limits: no headers, footers, footnotes, fields or drawing objects. Nested tables are flattened into their outer cells. Tab stops are drawn as fixed-width gaps.

License: MIT.
