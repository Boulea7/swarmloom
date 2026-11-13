---
"@swarmloom/adapter-html": patch
---

The HTML capture also freezes the animations inside `content-visibility: auto` sections. The capture frame sits off-screen, so the browser skipped those sections and their animations did not exist when the capture froze the page; the snapshot then started them at their first keyframe. Entrance effects in such sections were built invisible and loops sat at their start, then jumped to the frozen pose at go live (with `--no-live` the entrance content never showed). Now the sections show their contents while the animations are frozen and get their own styles back afterwards.
