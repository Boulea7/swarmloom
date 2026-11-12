---
"@swarmloom/adapter-terminal": minor
"@swarmloom/export": minor
"swarmloom": minor
---

Terminal recordings can fill the frame: `swarmloom render take.cast --terminal-font fill` grows the font until the window fills the frame's width or height (the window frame keeps its size). The default, `fit`, keeps 14 px and only shrinks it. The adapter option is `fill` (with `viewportHeight`), the render page's init option `terminalFont`.
