---
"@swarmloom/adapter-html": patch
---

HTML fragments follow the network policy in CSS and in older attributes too. An `@import` split around another one or spelled with CSS escapes, an escaped `url(`, a `url(` left open at the end, `image-set("…")` strings, the `background` attribute and SVG `<feImage>` no longer load anything the policy refuses. Escapes in selectors (`.md\:flex`) are kept as written.
