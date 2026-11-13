---
"@swarmloom/adapter-html": patch
---

HTML pages keep a `<style>` whose CSS has a `<` before a letter, `/` or `!`, such as an `@property` syntax string (`"<color>"`, which Tailwind v4 writes for gradients), a comment, a media range like `(width<40em)` or an SVG data: URL. Before, the sanitiser removed the whole style sheet and the page rendered unstyled. The network policy also reads an unquoted `url()` with a CSS hex escape (`url(a\3c b.png)`, as the sanitiser writes for that `<`) as one URL. Before, it made the value invalid, and the browser dropped the whole declaration, background colour included.
