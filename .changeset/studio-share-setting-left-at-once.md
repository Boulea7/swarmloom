---
"@swarmloom/studio": patch
---

A build setting changed on a `#d=` share link's page stays the user's on Back, Forward and reload even when the page is left before its link is encoded again without that setting: the page's history entry records the change at once, and the link's value no longer comes back over the saved one.
