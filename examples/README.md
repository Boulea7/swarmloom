# Examples

Samples for the supported formats live here, one folder per format: Markdown, HTML and web pages, DOCX, DOC, PDF, SVG, PPTX, XLSX/CSV, OpenDocument, EPUB, RTF, OFD, notebooks, mind maps, diffs, terminal recordings, Lottie animations, source code, images and 3D models. Studio uses these samples for its sample wall, and the browser tests play each one to the end.

## Sources and licenses

Most samples are written for this repository, by a script checked in next to them or by hand. They are MIT like the rest of the repository.

Some samples contain material from elsewhere, all MIT-licensed:

- `doc/headers-footers-unicode.doc` and `doc/table.doc` are real Word files copied unchanged from the test data of the [word-extractor](https://github.com/morungos/node-word-extractor) project, Copyright (c) 2016-2021 Stuart Watt. [`doc/SOURCES.md`](doc/SOURCES.md) lists their original paths and SHA-256 hashes.
- `docx/report.docx` and `slides/pitch.pptx` are built on the default templates of [python-docx](https://github.com/python-openxml/python-docx) and [python-pptx](https://github.com/scanny/python-pptx), Copyright (c) 2013 Steve Canny, and keep some template parts unchanged (Word styles, theme and font table; PowerPoint thumbnail and presentation properties). [`docx/SOURCES.md`](docx/SOURCES.md) and [`slides/SOURCES.md`](slides/SOURCES.md) list them.
- `sheet/sales.xlsx` holds the fixed theme part that [openpyxl](https://foss.heptapod.net/openpyxl/openpyxl) writes into every workbook, Copyright (c) 2010 openpyxl; see [`sheet/SOURCES.md`](sheet/SOURCES.md).

Each of these `SOURCES.md` files holds the full license text.

Generate new samples where you can. A third-party sample needs a license that allows redistribution, and a `SOURCES.md` in its folder that records the author, the source, the license and any required attribution, like `doc/SOURCES.md`. This includes a generator that starts from a library's built-in template (python-docx's `Document()`, python-pptx's `Presentation()`): the template ships inside the output. Do not add files of unknown origin. Studio builds, and so the CLI package, copy these notes (files named `SOURCES`, `LICENSE`, `LICENCE`, `NOTICE`, `COPYING` or `ATTRIBUTION`, with any extension) next to the samples they cover; they get no gallery tile.
