---
"swarmloom": patch
---

Web-page snapshots and `render <url>` no longer hang on a page that stalls the capture (for example by replacing `setTimeout` while a video never loads, or by busy-looping): the wait for web fonts, the script injection, the video freeze and the screenshot are bounded by the capture timeout, and the first Ctrl+C stops them.
