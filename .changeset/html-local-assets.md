---
"@swarmloom/adapter-html": patch
"swarmloom": patch
---

A local HTML file rendered with the CLI shows the images and fonts next to it (`<img src="hero.svg">`, `url("fonts/inter.woff2")`) instead of placeholders and fallback fonts. Images and fonts from the plain-http server the document came from now load under either network policy, as in the Markdown adapter.
