---
"@swarmloom/adapter-terminal": patch
---

Live terminal playback no longer stalls for a frame when a long output step starts: the continuation-prompt check stops at the first event that settles it instead of scanning the whole step.
