---
"@swarmloom/core": patch
---

A player in overlay mode (the extension and the bookmarklet, on the visited page itself) no longer fetches the page's own image files again to make still copies of animated images. Each fetch went to the site with its cookies and CORS-mode fetch headers, unlike the page's own image loads, so the site could tell that SwarmLoom was running. On the visited page those files keep their own clock, as cross-origin files do; `data:` and `blob:` URLs still show their first frame. Exports are unchanged.
