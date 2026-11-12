---
"@swarmloom/adapter-svg": patch
---

The SVG sanitiser now reads `<style>` text and `style` attributes token by token, as the browser does. Before, a comment or a quote could make one allowed `url()` look as if it covered the next one: in `url('#a'/**/),url(https://…)`, or with `url('#` written inside a comment or a string, the remote image after it was kept, and the browser fetched it when it showed the drawing.
