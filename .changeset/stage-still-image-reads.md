---
"@swarmloom/core": patch
---

The stage no longer fetches every same-origin image again each time the player mounts or replays. It remembers images that have no animation and shows them at once, and it reads files the page already loaded from the browser cache.
