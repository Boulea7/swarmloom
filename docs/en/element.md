---
title: Web Component
description: Embed cursor rebuilding anywhere with the <swarm-loom> element.
---

# Web Component

::: warning Current status
`define()` can register the element, but loading, playback and most attributes are still stubs. This page describes the planned complete component interface.
:::

`<swarm-loom>` wraps format loading and playback in a custom element for documentation sites, product pages and framework-independent embeds.

## Install and register

```bash
npm install @swarmloom/element
```

Register once on the client:

```ts
import { define } from "@swarmloom/element";

define();
```

Calling `define()` repeatedly is safe. It throws when `customElements` is unavailable or the tag belongs to another class. Importing the module itself does not touch the DOM, so it can appear in an SSR module graph; call `define()` only on the client.

```html
<swarm-loom
  src="/examples/intro.md"
  type="markdown"
  agents="24"
  speed="1"
  seed="7"
  theme="auto"
  labels="roles"
  finale="flock"
  autoplay
  controls
  sound
></swarm-loom>
```

Give the component an explicit size:

```css
swarm-loom {
  display: block;
  width: 100%;
  height: 480px;
}
```

## Attributes

| Attribute | Type / values | Description |
| --- | --- | --- |
| `src` | URL string | File or page to load; relative URLs resolve against the document |
| `type` | Adapter ID or MIME hint | For example `markdown`, `svg` or `pdf`; detected when omitted |
| `agents` | Positive number or `auto` | Cursor count; defaults to `auto` |
| `speed` | Number above 0 | Build speed; defaults to `1` |
| `seed` | Finite number | Deterministic random seed |
| `theme` | `auto` / `light` / `dark` | Stage and toolbar theme |
| `labels` | `names` / `agents` / `roles` / `none` | Cursor labels |
| `finale` | `flock` / `halo` / `none` | Behaviour after the build |
| `autoplay` | Boolean attribute | Play after loading; audio still needs a user gesture |
| `loop` | Millisecond number | Wait this long after completion, then replay |
| `controls` | Boolean attribute | Show the built-in toolbar |
| `sound` | Boolean attribute | Enable synthesised effects |
| `inview` | Boolean attribute | Start through IntersectionObserver when scrolled into view |
| `reduced-motion` | `auto` / `true` / `false` | Reduced motion; defaults to the system preference |

A boolean attribute is on when present, including an empty value such as `<swarm-loom autoplay>`. The values `false`, `off`, `no` and `0` (case-insensitive) turn it off, as does removing the attribute. `loop` follows the same rule: a bare `loop` waits 1500 ms, and `loop="0"` turns looping off rather than meaning no delay.

## Use Light DOM content

Without `src`, the component is planned to snapshot its Light DOM children:

```html
<swarm-loom controls reduced-motion="auto">
  <article>
    <h1>Hello, swarm.</h1>
    <p>These elements become a Blueprint.</p>
  </article>
</swarm-loom>
```

This is a subtree snapshot. It does not execute child scripts or clone application state. Do not rely on Light DOM simultaneously as fallback content for a remote source.

## Methods

```ts
import type { SwarmLoomElement } from "@swarmloom/element";

const el = document.querySelector<SwarmLoomElement>("swarm-loom");
if (!el) throw new Error("Missing player");

await el.load({
  name: "note.md",
  type: "text/markdown",
  text: "# Hello\n\nBuilt by a swarm.",
});

el.play();
el.pause();
el.replay();
```

| Method | Purpose |
| --- | --- |
| `load(input)` | Load a `SourceInput`, detect its format and prepare a Blueprint; returns a Promise |
| `play()` | Start or resume playback |
| `pause()` | Pause the engine clock |
| `replay()` | Reset the current reveal and play from the start |

`input` accepts `bytes`, `text`, `url` or `element`. Remove the element from the DOM when no longer needed; disconnected-element cleanup belongs to the component implementation.

## Events

| Event | Timing |
| --- | --- |
| `swarm-state` | Player state changes |
| `swarm-progress` | Built or total layer count changes |
| `swarm-done` | Build completes |

```js
const el = document.querySelector("swarm-loom");

el.addEventListener("swarm-state", (event) => {
  console.log("state", event.detail);
});
el.addEventListener("swarm-progress", (event) => {
  console.log("progress", event.detail);
});
el.addEventListener("swarm-done", () => {
  console.log("build complete");
});
```

Use the component's published type declarations for event payloads. Listener callbacks should not block the playback loop.

## CDN build <Badge type="warning" text="Planned" />

The package is planned to ship `dist/swarm-loom.global.js` as an IIFE build for pages without a bundler. The release will provide a version-pinned URL and global name; do not use an unpinned `latest` URL in production.

## Accessibility and performance

- Provide pause controls even when autoplay is enabled.
- Keep `reduced-motion="auto"` to respect the system preference.
- Use `inview` for below-the-fold instances to avoid offscreen work.
- Expect sound to require a user gesture; autoplay rejection is not exceptional.
- Each instance owns its stage and resources. Remove unused instances so long-lived pages do not accumulate them.
