---
"@swarmloom/core": minor
"@swarmloom/adapter-office": patch
"@swarmloom/adapter-odf": patch
"@swarmloom/adapter-rtf": patch
"@swarmloom/adapter-epub": patch
"@swarmloom/adapter-ofd": patch
---

Font notes now name only the fonts the device is missing. Before, PPTX, XLSX, OpenDocument, RTF, EPUB and OFD files said "Calibri → Carlito" or "SimSun → Noto Serif SC" for every font in the table, even when the original was installed and shown. The new core `missingFonts(document, names)` compares text widths on a canvas to find faces that are neither installed nor loaded, and counts another name of the same face (SimSun for 宋体) as installed. Where it cannot measure, as in Node, no substitution is reported.
