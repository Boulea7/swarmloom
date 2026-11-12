---
"@swarmloom/export": patch
---

Exporting in the browser now keeps a scaled or turned box where the page draws it when it turns about its top left corner. Each element in the frame image starts from reset styles, which turn and scale about the centre, and a `transform-origin` or `perspective-origin` of `0 0` was taken for that reset value and left out. A stage whose blueprint is narrower or wider than the export, OFD and fixed-layout EPUB pages, ODF slides and SVG shapes with a `transform` drew shrunk towards the middle. Both origins are now written whenever a transform or perspective uses them.
