---
"@swarmloom/export": patch
---

The in-browser exporter reads, embeds and URI-encodes each web font face once per export instead of on every frame. Before, every frame serialised all `@font-face` rules again, scanned their data URLs with regular expressions and encoded them into the frame image, so a page with a few megabytes of fonts spent about 45 ms more per frame on the main thread. A face declared in several places (KaTeX fonts sit in the page, in the stage's sheet and in the FontFace API) is now embedded once, not three times. Only the faces the frame's text can use are embedded, matched by weight, style, stretch and `unicode-range`, so fonts split into many subsets or weights no longer pay for the parts the frame does not show.
