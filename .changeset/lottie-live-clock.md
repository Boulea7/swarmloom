---
"@swarmloom/adapter-lottie": patch
"@swarmloom/export": patch
---

A Lottie animation keeps playing after go live. A realtime player (Studio, the embed element, `createPlayer` without a `clock`) stops its clock once live, which froze the animation and the timeline's playhead, while video exports kept playing it. The player now plays on in wall time from where it was (`createLottieAdapter({ liveClock: "own" })`, the default), and the playhead follows it through the new optional `AnimTarget.subscribe`. The render page passes `liveClock: "player"`, so exported frames stay on video time.
