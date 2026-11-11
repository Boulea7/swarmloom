---
"@swarmloom/core": minor
"@swarmloom/adapter-svg": patch
---

Plugins can give every player its own instance: when a plugin has `perPlayer()`, each player calls it once and uses the result, so one `LoadedSource` can drive several players at once without them resetting each other. The `svg`, `lottie` and `anim:timeline` plugins use it. `StageApi.reducedMotion` tells plugins that the player builds without motion. Finishing a Lottie build early (finish now, go live) now starts the animation from the woven frame; reduced motion still keeps the still frame.
