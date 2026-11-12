---
"swarmloom": patch
---

`swarmloom render` starts the browser without partial raster. Chromium redrew only the changed part of a tile, so the antialiased edges of rounded boxes could differ by one level with the number of frames the browser drew between two captures, and two renders of the same file with the same seed gave different frame hashes (the table of the Markdown welcome example, frames 174–197).
