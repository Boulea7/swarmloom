---
"@swarmloom/export": patch
---

Exporting in the browser now keeps fonts that adapters register from bytes, such as the fonts embedded in an EPUB. The bytes come from the export frame's own realm, where the rasteriser's `instanceof ArrayBuffer` check failed, so every such face was embedded as an empty data URL and the text was drawn in a fallback font. Each face is now also encoded once, not again for every frame.
