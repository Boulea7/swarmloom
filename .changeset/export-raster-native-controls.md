---
"@swarmloom/export": patch
---

Form controls keep their native look in in-browser exports. The snapshot gave text fields, buttons, selects, progress bars and meters the browser's own border and background as author styles, which turns Chromium's native drawing off: frames showed thick inset fields and grey and green fallback bars. Controls now start from the browser's styles and get only what the page changed, in the colour scheme their colours show. Placeholders keep the browser's grey instead of turning black.
