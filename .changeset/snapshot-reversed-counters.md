---
"@swarmloom/snapshot-dom": patch
---

`counter(list-item)` in `::before` / `::after` counts down in reversed lists (`<ol reversed>`, `counter-reset: reversed(…)`), with the numbers the browser draws: Chromium's for its built-in list numbering, the CSS Lists start value where the engine exposes reversed counters (Firefox, which also maps `<li value>` to `counter-set`).
