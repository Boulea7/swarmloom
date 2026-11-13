---
"@swarmloom/export": patch
"swarmloom": patch
---

After go live, a rendered HTML page that sets no background of its own (no `html` or `body` background) no longer shows every element twice. The live page is shown on the canvas colour a browser tab paints under a page, so the stage's frozen copy under it no longer shows through: a looping animation showed a still copy next to the moving one, and static text got heavier at go live.
