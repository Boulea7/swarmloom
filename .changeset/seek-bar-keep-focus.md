---
"@swarmloom/core": patch
---

In overlay mode, stepping back on the toolbar's seek bar with the keyboard no longer moves focus to the stage. Before, the replay behind a backward seek put focus on the stage's scroller, so the next arrow key scrolled the page instead of seeking. Focus that is already on the stage now stays where it is when a build starts.
