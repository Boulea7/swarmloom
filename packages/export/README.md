# @swarmloom/export

Deterministic video and audio export for SwarmLoom: the CLI's render page, the same export inside a web page (`@swarmloom/export/browser`), and a quick in-browser recorder.

## Render page (used by the CLI)

`dist/render/index.html` is a headless page, also exported as `@swarmloom/export/render/*`. Its build also writes `dist/render.sources.json`, the hashes of the workspace files and lockfile it was built from; the CLI build uses it to rebuild a stale page. It sets `window.__swarmloom` and marks `<html data-swarmloom="ready">`. A driver such as the `swarmloom render` CLI over CDP calls:

1. `init({ input, width, height, fps, seed?, agents?, speed?, theme?, labels?, overlays?, sound?, tail?, live?, follow?, reducedMotion?, bpm?, pack?, cues?, blueprint? })`, which returns `{ estimatedMs, layers, blueprintSha256 }`.
   - `blueprintSha256` hashes the blueprint JSON after replacing what changes from run to run: the directory the input was served from becomes `input:/`, each `blob:` URL becomes `blob:sha256-` plus the hash of its bytes, and other addresses on the render page's own origin (such as footnote links resolved against the page) start with `page:/`. Remote URLs stay. The same input gives the same hash.
   - `overlays` is `full` (default), `minimal` (no size badges, distance labels, guide lines or rulers) or `none` (cursors, name tags and content only).
   - `input` is `{ name, type?, base64? | text? | url? }`. If `type` contains a slash it is a MIME type; otherwise it is an adapter id or extension that overrides detection.
   - `blueprint` (optional) is a blueprint the driver already captured, such as the CLI's live snapshot of a web page. It is played as is and `input` is not loaded.
   - The player runs inline at `width` x `height` on a `VirtualClock`, with controls off.
2. `step(1000 / fps)` advances the clock, waits for `player.ready()` (fonts, images, decode) and for the page's next three animation frames (by then the browser has rastered and shown the step), and returns `{ state, built, total, done }`. Take a screenshot after each step until `done`. A run is done once the build has finished and `tail` ms (default 2500) have passed.
   - Go live: unless `live` is `false` or `reducedMotion` is on (which keeps the end state), the player goes live once the finale settles, as the toolbar's go live does. The cursors leave and the stage becomes the finished page. An HTML document is loaded with the adapter's `keepLive` frame at the frame height, and that real page is shown over the stage at the same scroll position. From then on every step pauses all Web Animations (the page, every stage subtree, the live page) and the live page's SVG documents and seeks them to the frame time, so the tail never depends on wall time. `<marquee>` elements on the live page, which no seek reaches, hold their resting pose, and its animated `<img>` elements (SVG, GIF, APNG, WebP or AVIF the render page can read) show still copies from `stillImageSource` (@swarmloom/core), swapped in during `init()`; animated CSS images of its elements (backgrounds, masks, border images, list markers, not pseudo-elements) are overridden inline with the same copies (`holdAllCssImages`), and so are the images its inline SVG embeds (`<image>`, `<feImage>`: `holdSvgImages`). SVG SMIL replays (`createSvgAdapter({ liveClock: "player" })`) and Lottie players (`createLottieAdapter({ liveClock: "player" })`) follow player time themselves. The same input, options and seed give the same frames.
3. `audioWav(durationMs?)` returns the run's sound log rendered offline to a 48 kHz stereo WAV, as base64. Pass the video's length (frames * 1000 / fps) so the WAV matches it; the default, the elapsed time, is one frame shorter.
4. `dispose()`.

Invalid `init` options reject with a `TypeError` that names the field. Recoverable player errors do not stop a render; the page logs them with `console.warn`. Only one render can be active per page.

## Library

- `exportFrames(playerOptions, { fps, onFrame, tailMs?, maxDurationMs?, onWarning?, signal? })` runs a player on a `VirtualClock`. It calls `onFrame(index, timeMs)` for each frame once the frame's assets are ready, and returns `{ frames, durationMs, soundLog, warnings }`. Frame `n` shows engine time `n * 1000 / fps`. Player `error` events (skipped layers, a failed layer task, sound) are recoverable: they go to `onWarning` and `warnings` and the export goes on. Throw from `onWarning` to abort instead.
- `renderAudioWav(soundLog, durationMs, options?)` renders sound events to WAV bytes with `OfflineAudioContext`.
- `RenderSession` is the clock-and-player stepping used by both of the above.
- `createRenderApi(deps)` builds the `window.__swarmloom` object with your own loader and player factory. `deps.load` gets the frame height too (`{ format, height }`); a loaded source with a live page (`LoadedHtml.live`) gets it shown on go live.
- `RenderSession` takes `live: true` to go live once the finale settles.

## In-browser export

`@swarmloom/export/browser` makes the CLI's video in a web page, with no screenshots and no share prompt. Studio's Export dialog uses it.

```ts
import { exportVideo } from "@swarmloom/export/browser";

const result = await exportVideo({
  input: { name: "notes.md", text },
  width: 1280,
  height: 720,
  fps: 30,
  settings: { seed: 1, theme: "light", sound: true },
  signal,
  onProgress: (p) => console.log(p.phase, p.frames, p.totalFrames, p.etaMs),
});
// result.blob is an MP4 (H.264) or WebM (VP9); result.extension says which.
```

- A hidden same-origin `<iframe srcdoc>` runs the render page (the code of `dist/render`) in its own window. The exporter calls `init()` and `step(1000 / fps)` in the CLI's order, so the same input, settings and seed give the same frames as `swarmloom render`. `settings` takes the `init` options other than input, size, fps, `cues` and `blueprint` (the same player settings as the CLI's; the in-page export has no cues and always loads `input`).
- The frame sees the media features of the CLI's browser at `--scale 1`, whatever the user's system settings, screen and input devices: no motion, transparency or contrast preference and no forced colours, `prefers-color-scheme: dark` for `theme: "dark"` and `light` otherwise (`auto` included), one device pixel per CSS px, an 8-bit sRGB standard-range screen (`color-gamut: srgb`, `dynamic-range: standard`) the size of the video (`device-width`, `device-height`), a mouse (`pointer: fine` and `hover: hover`, also for `any-pointer` and `any-hover`) and `display-mode: browser`. `devicePixelRatio` is 1, `matchMedia` answers with those values, the frame's document takes only that color scheme, and while the host differs the tests of those features in the frame's style sheets (the stage, the HTML adapter's page) are rewritten to their answers. Reduced motion in an export is the `reducedMotion` setting only. Not pinned: images chosen by `srcset`, `image-set()` or `<source media>`; `screen` and `navigator.maxTouchPoints` as scripts read them; the browser's own colours (default text, form controls) in a page that takes both schemes with `color-scheme: light dark`, which follow the system; and text anti-aliasing, which Chromium adapts to a high-density screen, so frames from such a screen can differ slightly in text edges.
- Each frame is serialised into an SVG `<foreignObject>` image (computed styles inlined, shadow roots and same-origin iframes flattened, images and fonts embedded as data URLs, each resource at most once for image elements and once for CSS however often it is used; of the web fonts, only the faces the frame's text can use, by weight, style, stretch and `unicode-range`, each once however many sheets declare it, read and encoded once per export), drawn into a canvas and handed to the encoder. Only what can show is written: subtrees more than 256 px away from the viewport are left out (out of flow) or written as empty boxes of their size with only the properties that size and place them (in flow: the sections, headings, paragraphs and quotes of a long live page, with the margins their content shares with them, inside `display: contents` or inline wrappers too, inline blocks aligned by their top, middle or bottom, and the cells of table rows away from the viewport), and boxes under a frame that covers the whole viewport are left out. SVG elements with an id inside what is left out (the clip paths and gradients of an exported icon, a symbol) are written on their own, drawn nowhere, when something written refers to them. The canvases painted last (the cursor layer, and a WebGL model under it) are drawn over the image instead of being encoded into it as PNGs. Text a page does not write itself (a counter or list marker in a script its text does not use) can fall back to another font when the web font is split by `unicode-range`. Nothing depends on wall time. With `hashFrames: true`, `result.frameSha256` holds the SHA-256 of every frame's RGBA pixels before encoding, so two runs can be compared; it costs a readback per frame, so it is off by default. The encoded files can still differ: Chromium's encoders do not write the same bytes on every run, though the decoded frames look the same.
- WebCodecs encodes H.264 when `isConfigSupported` accepts it at this size, else VP9; [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0, used unmodified) writes the MP4 or WebM. Timestamps come from the frame index. Encoded frames wait in `Blob` parts, outside script memory, and at the end the file is muxed with the soundtrack straight into `Blob` parts, so the video does not pile up in script memory however long it is. The MP4 reserves room for its index ahead of the media (fast start, as from the CLI), a few dozen bytes per frame at most.
- Sound: the run's sound log rendered with `OfflineAudioContext` in one piece, as the CLI renders it (about 23 MB of samples per minute, held while they are encoded), encoded as AAC or Opus. When neither encoder exists the video is silent, `result.soundUnsupported` is true and a warning says so.
- The loop yields to the event loop after every frame, and the snapshot of a frame pauses every few milliseconds (starting over when the page changed meanwhile), so the page stays responsive; `signal` cancels between frames and at those pauses; while the hidden frame is still starting or loading the input, it removes the frame at once. Without WebCodecs `exportVideo` throws `UnsupportedExportError`; `hasWebCodecs()` checks first.
- `maxDurationMs` (default 10 minutes) caps a build that never ends; `result.finished` is false then.

Limits of the snapshot: custom `::marker` and `::first-letter` styles are not reproduced, `position: sticky` does not stick, WebGL canvases show what reading them back returns at capture time (`drawImage()` when drawn over the image, `toDataURL()` when something paints over them), cross-origin images and videos without CORS are left blank (with a warning), a video's native controls are drawn as a likeness of Chromium's, and ink reaching more than 256 px past the boxes of a subtree away from the viewport (a huge shadow, a fixed-position pseudo-element) is not drawn.

The frame loads one of this package's modules as a module script. In a bundled app that module shares chunks with the app's entry, so the entry must not start the app inside the frame: check `isExportFrame()` first. Style sheets a bundler's preloader links into the frame are switched off.

## Quick recording

`recordElement(element, { mimeType?, fps?, videoBitsPerSecond?, audio?, signal? })` records an element live. It must be called from a click handler. It asks the user to share the current tab, crops the capture to the element (Element Capture, else Region Capture), mixes in audio and encodes with `MediaRecorder` (WebM, or MP4 where WebM is unavailable).

The `audio` option takes `"tab"` (default), an `AudioNode`, a `MediaStream` or `false`. Call `stop()` to finish, or read `result`, which also settles when the user stops sharing.

This is a real-time recording, not a deterministic export. `canRecordElement()` reports support. Failures throw a `RecordingError` with code `unsupported` (the message points to `npx swarmloom render`), `denied`, `wrong-surface` or `failed`.

License: MIT. Mediabunny, a dependency of the in-browser export, is MPL-2.0.
