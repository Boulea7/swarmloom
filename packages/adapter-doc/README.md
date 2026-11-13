# @swarmloom/adapter-doc

The Legacy DOC adapter for SwarmLoom. It reads Word 97-2003 binary documents (.doc) in pure JavaScript, in the browser and in the CLI alike. It needs no Word, LibreOffice or server. The document's sections are drawn as page sheets on a desk and snapshotted into a blueprint whose pages are `page` box layers. Load it through `@swarmloom/formats` so that it is only fetched when a .doc is opened.

```ts
import { loadDoc } from "@swarmloom/adapter-doc";

const { blueprint, notes, pages, view } = await loadDoc({ name: "report.doc", bytes }, { document, width: 1000, theme: "light" });
```

## What it reads

The parser opens the compound file (cfb) and validates the File Information Block. It then decodes the text of every story through the piece table. Fast-saved files and both 8-bit and UTF-16 pieces are handled.

- **Always read:** paragraphs, tables, headers and footers (with inheritance between sections), footnotes, endnotes and http(s)/mailto hyperlinks.
- **Best effort:** styles, headings (built-in heading styles and outline levels), list numbering, section page sizes and margins, fonts and inline PNG/JPEG pictures. If one of these tables is damaged, the document still opens without it, and `notes` says what was skipped.
- **Not shown:** text boxes, comments, floating shapes and embedded objects. `notes` lists them.

## Text mode and rich mode

v1 opens documents in **text mode** by default. Text mode shows the text and its structure in the document's body font: headings, lists, tables, headers and footers, notes and sections. It leaves out pictures and character formatting (fonts, sizes, colours, emphasis), and the first note says so.

`createDocAdapter({ mode: "rich" })` adds character formatting and inline pictures. Rich mode is best effort.

## Pagination

Sheets start only at sections that begin on a new page, at explicit page breaks and at paragraphs with "page break before". Word's automatic page flow is not imitated, so a sheet grows to hold everything up to the next break. Each sheet uses its section's paper size and margins. Sheets wider than the screen are narrowed and the text reflows; nothing is scaled.

## Format routing (decisions F02)

The adapter checks what a file with a .doc name really contains:

| Content | Result |
| --- | --- |
| Word 97-2003 compound file | parsed here |
| Word 2007+ package (ZIP) | opened with `@swarmloom/adapter-docx`. `view` is `"docx"` and the first note says so. |
| RTF, HTML, MHTML, Word 2003 XML | `DocError` with code `wrong-format` and `format` set to `rtf`, `html`, `mhtml` or `wordml`, so the caller can hand the file to the right adapter |
| Word 6/95, Word 2.x, Word for DOS | `unsupported-version` |
| Password protected or XOR obfuscated | `encrypted` |

The other error codes are `not-cfb`, `not-word`, `corrupt`, `too-large` and `no-input`. Files may be at most 64 MB.

## Result

`loadDoc` returns a `DocLoadedSource`:

- `notes`: short English sentences for the UI (a field of `DocLoadedSource`, not of the core `LoadedSource` contract);
- `pages`: the number of sheets;
- `view`: `"text"`, `"rich"` or `"docx"`.

`parseDoc(bytes)` returns the intermediate `DocModel` (sections, blocks, notes, fonts, warnings) for other uses.

## Samples

`examples/doc/` contains three samples:

- `report.doc` and `table.doc`: written byte by byte by `examples/doc/generate.py`, using the Python standard library only. `report.doc` has three sheets, the last one landscape; `table.doc` is one sheet with a 5 x 6 table bordered through table-wide borders.
- `headers-footers-unicode.doc`: a real Word file from the word-extractor test data. It is Apache POI's test file `HeaderFooterUnicode.doc` (Apache-2.0, with POI's NOTICE).

See `examples/doc/SOURCES.md` for where they come from and their licences.

License: MIT. Runtime dependency: cfb (Apache-2.0).
