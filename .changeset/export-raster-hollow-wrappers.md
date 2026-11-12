---
"@swarmloom/export": patch
---

Exporting a long live page in the browser is faster when what lies away from the viewport sits in a `display: contents` or inline wrapper (framework wrappers, custom elements), in inline blocks aligned by their top, middle or bottom, or in a table: those boxes are now written as empty boxes of their size too, and a table row away from the viewport keeps only what sizes its cells. At 1280 × 720, a frame's snapshot of 1,100 cards inside `display: contents` took about 0.2 s instead of 1.3 s, and of a 1,100-row table about 0.55 s instead of 1.9 s.
