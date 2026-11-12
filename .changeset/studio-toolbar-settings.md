---
"@swarmloom/core": minor
"@swarmloom/studio": patch
---

The player reports a `settings` event (speed, sound and follow mode) whenever `setSpeed`, `setSound` or `setFollow` change a value, including through the built-in toolbar and its shortcuts. Studio takes those changes as the user's settings: after picking 2× on the player's toolbar, muting with M or switching the tour with T, the settings panel, a new share link, the Export dialog's video and its CLI command (`--speed 2`) and the next player all use them. Before, they kept the values from before the change.
