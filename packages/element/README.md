# @swarmloom/element

`<swarm-loom>` is a custom element that plays a SwarmLoom build of a file, a URL or its own children inside any page, for site intros and documentation demos.

```html
<script type="module">
  import { define } from "@swarmloom/element";
  define();
</script>

<swarm-loom src="/notes.md" autoplay inview loop sound></swarm-loom>

<swarm-loom inview speed="1.5">
  <h2>Hello</h2>
  <p>Without <code>src</code>, the children are the content that gets built.</p>
</swarm-loom>
```

It is safe to import during server-side rendering: nothing touches the DOM until `define()` runs, and `define()` throws if custom elements are unavailable.

## Attributes

| attribute | value |
| --- | --- |
| `src` | URL to fetch, detect and load (relative to the page). |
| `type` | Format id, extension or MIME type that overrides detection. |
| `agents` | `auto` or a cursor count (1-128). |
| `speed` | Speed multiplier, 0.1-8, default 1. |
| `seed` | Integer seed; the same seed replays the same build. |
| `theme` | `auto`, `light` or `dark`. |
| `labels` | `names`, `agents`, `roles`, `none`, or a comma-separated list of cursor names. |
| `finale` | `flock`, `halo` or `none`. |
| `autoplay` | Start once loaded. |
| `inview` | Start when scrolled into view; pause offscreen and resume on return. |
| `loop` | Replay once the finale has settled. A bare `loop` waits 1500 ms; `loop="4000"` waits 4 s. |
| `controls` | Show the player controls. |
| `sound` | Enable sound. Browsers only start audio after a user gesture. |
| `reduced-motion` | `auto` (follow the OS setting), `true` or `false`. |

Boolean attributes treat `false`, `off`, `no` and `0` as off. `src` and `type` reload the content. `speed` and `sound` apply live. The other player attributes rebuild the player.

## Script API

- `el.load(input)` loads a `SourceInput` (bytes, text, URL or element), which takes precedence over `src`.
- `el.play()`, `el.pause()` and `el.replay()` control playback; `play()` before the content is ready starts it once it is.
- `el.player` is the current player (or `null`). `el.ready` resolves when the latest load or rebuild has settled; it never rejects, so listen for `swarm-error`.

## Events

All events bubble and cross shadow boundaries.

- `swarm-state`: `{ state }`.
- `swarm-progress`: `{ built, total }`.
- `swarm-done`: the build is complete.
- `swarm-error`: `{ error }`. A `SourceError` from `@swarmloom/formats` has a `code`. Call `preventDefault()` to hide the built-in message.

The shadow parts are `root`, `content`, `stage` and `error`. In children mode the real children stay in the accessibility tree and the stage is `aria-hidden`.

## CDN

```html
<script src="https://unpkg.com/@swarmloom/element/dist/swarm-loom.global.js"></script>
<swarm-loom src="deck.pptx" inview></swarm-loom>
```

The IIFE build defines the element and exposes `window.SwarmLoom` (`define`, `configure`, `SwarmLoomElement`). It contains no adapter code. When a source needs an adapter, it loads `swarm-loom.adapters.js` and that adapter's chunk from `chunks/`, relative to the script URL. Host the whole `dist/` folder together.

`configure({ createPlayer, formats, maxBytes })` replaces the shared runtime, for example to restrict formats or lower the download limit.

License: MIT.
