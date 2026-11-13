---
"@swarmloom/export": patch
---

After go live, a transition or animation that the page's next rendering update starts (a scroll-state query that sticks a header once go live scrolls the page, the fallback an anchor-positioned tooltip flips to) plays from its start at the frame time. Before, it ran on wall time through the frame's screenshot or snapshot and jumped back to its start on the next frame, so the go-live frame of such a page differed between runs of `swarmloom render` and of an in-browser export, and the frames after it changed with the frame rate. Each step now waits for that update on the frame that went live, and on later frames only when the page's styles hold scroll-state queries or `position-try` fallbacks (or a style sheet of another origin, whose rules cannot be read): one display frame more per such frame, and one more after each update that started a transition or animation, since seeking it can start another at the update after (three at most).
