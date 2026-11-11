---
"@swarmloom/adapter-lottie": patch
---

Loading a large Lottie animation no longer freezes the page: the off-screen rendering and measuring of candidate frames runs in slices of about 10 ms with host turns in between, and an abort through `ctx.signal` now stops the load there.
