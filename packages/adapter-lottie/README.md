# @swarmloom/adapter-lottie

The Lottie adapter for SwarmLoom. It reads Lottie JSON (Bodymovin) and dotLottie archives (`.lottie`, v1 and v2). The swarm first weaves one frame of the animation as vector layers. Then one cursor drags out a small timeline under it, drops the keyframes, scrubs the playhead, and the real animation starts playing. Load it through `@swarmloom/formats` so lottie-web is only fetched when an animation is opened.

```ts
import { lottieAdapter } from "@swarmloom/adapter-lottie";

const source = await lottieAdapter.load({ name: "intro.lottie", bytes }, { document, width: 960, theme: "light" });
// Pass source.blueprint and source.plugins to the player; source.notes lists anything that was removed.
```

How it works:

- Input is checked before it is drawn (`parseLottie`): version, frame rate, in and out points, size and layers, with limits on file size (50 MiB), nesting depth, layer and keyframe counts, duration (600 s) and embedded images. Expressions are removed and never run; an animation that moves only through expressions is rejected with a hint to bake them into keyframes. Images must be embedded (`data:image/*`) or packed in the `.lottie` archive, and slots that would swap in another image path are removed, as are assets that repeat an earlier asset's id (lottie-web only uses the first). Audio, data layers and web fonts are removed. Text animators with a random letter order play in a fixed order, so plays and exports match.
- `.lottie` archives are unpacked with [fflate](https://github.com/101arrowz/fflate) (MIT). Only the manifest, the animation JSON and images are read, with limits on entries, unpacked size, compression ratio and entry names. The manifest's active animation, loop, speed and background colour are used.
- lottie-web's light SVG renderer ([lottie-web](https://github.com/airbnb/lottie-web), MIT) is loaded on first use. It is assembled from its modules without the build's entry module, so there is no `window.bodymovin` global and no poll that loads `.lottie` elements of the host page.
- The animation is drawn off-screen to pick the frame to weave: the frame with the most visible area (keyframes win near-ties), or the last frame when the animation settles there (intro-style files). The `pose` option picks it explicitly. Drawing and measuring the candidate frames runs in slices of about 10 ms with host turns in between, so the page stays responsive and an abort (`ctx.signal`) stops the load there. The frame is converted by `@swarmloom/adapter-svg`: shapes become path layers with their fills and strokes, text becomes typed text (one layer per line), images become image layers. A solid that fills the whole composition becomes the stage background; without one, a `.lottie` manifest background does (a translucent one is blended over the paper).
- Two custom layers finish the blueprint. `lottie:player` covers the composition; it is built first and stays invisible. `anim:timeline` sits under the composition and is built last. Its cursor drags the bar out, drops one diamond per keyframe, grabs the playhead at the woven frame, scrubs back to the start and across the cycle, then starts playback.
- Playback follows engine time only (`Plugin.frame`), in whole source frames, through `goToAndStop(frame, true)`. lottie-web never runs its own clock, so the same player time always shows the same frame and video exports match live playback. Pausing the player pauses the animation; replay and seeking back return to the woven frame. The animation loops by default; the `loop` option or the dotLottie manifest can make it play once or n times.
- With reduced motion the timeline appears complete and the woven frame stays; nothing plays. When the build is finished early (finish now, go live) before the timeline started playback, the timeline appears complete and the animation plays on from the woven frame.

Options (`createLottieAdapter`): `pose` (`"auto"`, `"first"`, `"last"` or a frame number), `loop` (`true`, `false` or a play count), `animationId` (for archives with several animations), `maxBytes` (50 MiB), `maxLayers` (1500, including the player and the timeline).

## The timeline for other animations

The `anim:timeline` plugin (`createAnimTimelinePlugin`) does not depend on Lottie. Any plugin can register an `AnimTarget` on the element of its layer (`registerAnimTarget`) and point an `anim:timeline` layer at that layer (`AnimTimelineData.target`). `collectKeyframes(element)` reads the duration and keyframe times of CSS animations and transitions, `element.animate()` animations (`getAnimations()`) and SVG SMIL elements (`begin`, `dur`, `keyTimes`), for the timeline's diamonds. Event-based and indefinite timings are skipped. Targets must take their time from the engine (`Plugin.frame`), never from `requestAnimationFrame`.

Every player gets its own plugin instances (`Plugin.perPlayer`), so several players can play one loaded source at once. Limits: expressions, audio and effects that the light SVG renderer does not draw are not shown. The timeline waits for the woven layer that is built last, not for every woven layer, so a long typing task can still be finishing when playback starts.

License: MIT.
