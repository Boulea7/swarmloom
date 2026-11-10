# @swarmloom/adapter-office

Office formats for SwarmLoom. The package exports two stub adapters: `slidesAdapter` (id `slides`: PPTX, with legacy PPT and ODP planned) builds each slide as its own stage section, and `sheetAdapter` (id `sheet`: XLSX, XLS, ODS, CSV, TSV) fills a cell grid row by row. Their `load()` throws until the implementation lands. Load them through `@swarmloom/formats` so they are only fetched when needed.

License: MIT.
