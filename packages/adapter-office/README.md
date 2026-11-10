# @swarmloom/adapter-office

Office formats for SwarmLoom. Two adapters, each with its own entry point so a page only loads the one it needs:

| Import | Adapter | Reads |
| --- | --- | --- |
| `@swarmloom/adapter-office/slides` | `slidesAdapter` (id `slides`) | PPTX |
| `@swarmloom/adapter-office/sheet` | `sheetAdapter` (id `sheet`) | XLSX, XLSM, ODS, CSV, TSV |

The package root re-exports both. Apps normally load them through `@swarmloom/formats`, which imports them lazily.

## Slides

Each slide becomes a 16:9 page box (role `slide`), stacked vertically with gaps. The adapter reads the slide, layout and master parts and the theme, and emits layers directly:

- backgrounds (solid, gradient, picture) from the slide, layout or master;
- shapes with preset or custom geometry, solid and gradient fills, outlines and shadows;
- text bodies with runs (size, bold, italic, colour, font), bullets and numbering, alignment and placeholder inheritance;
- pictures as blob URLs (released by `dispose()`), with cropping;
- simple tables;
- charts, SmartArt, video and unsupported image types as labelled placeholders.

Options: `createSlidesAdapter({ maxSlides })` (default 40). Legacy `.ppt` and OpenDocument `.odp` are rejected with a message that suggests saving as PPTX or PDF.

## Sheets

Each visible sheet (up to 3) is drawn as a page with a sheet tab, column and row header bars, grid lines (path layers, built first), cell fills (boxes) and cell text (role `cell`) typed row by row. Numbers are right-aligned and a header row is detected. From XLSX/ODS it reads shared strings, number formats, bold/italic/colour, fills, borders, merged cells, column widths and row heights. Formulas are never evaluated: the saved result is shown, or the formula text when there is none.

CSV and TSV use a small parser that handles quotes, line breaks inside quotes, a UTF-8/UTF-16 BOM and delimiter sniffing (`parseCsv`, `sniffDelimiter` are exported).

Options: `createSheetAdapter({ maxRows, maxCols, maxSheets })` (defaults 200, 30, 3). Legacy `.xls` is rejected with a message that suggests saving as XLSX or CSV.

## Limits and notes

- Content dropped by a limit is reported in `Blueprint.truncated`.
- `notes` on the loaded source (type `OfficeLoadedSource`; proposed as an optional core `LoadedSource` member) lists what is shown differently from the original: placeholders, unreadable slides, formulas without a saved result, workbook drawings, and Office fonts shown with open substitutes (Calibri with Carlito, Cambria with Caladea, Arial with Liberation Sans, SimSun with Noto Serif SC, Microsoft YaHei with Noto Sans SC, and so on). No font files are bundled.
- Nothing in a file is executed or fetched: no macros, no external links. ZIP containers are read with size and entry limits.

Dependency: [fflate](https://github.com/101arrowz/fflate) (MIT).

License: MIT.
