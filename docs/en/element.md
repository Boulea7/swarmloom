---
title: Web Component
description: Embed cursor rebuilding anywhere with the <swarm-loom> element.
---

# Web Component

::: info Current status
The element loads, plays and reflects the attributes below. `@swarmloom/element` is not on npm yet; build it from source for now.
:::

`<swarm-loom>` wraps format loading and playback in a custom element for documentation sites, product pages and framework-independent embeds.

## Install and register

`@swarmloom/element` is not on npm yet. Build it from source (Node.js 22.12 or later):

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm --filter "@swarmloom/element..." build
```

The last command builds the element and the workspace packages it depends on, and writes `packages/element/dist/`. Then use it in one of two ways:

- **Without a bundler**: copy the whole `packages/element/dist/` folder to your site and load the [script build](#script-build), which registers the element itself.
- **With a bundler**: install the built folder into your project, then register the element as shown below.

  ```bash
  npm install /path/to/swarmloom/packages/element
  # or with pnpm:
  pnpm add link:/path/to/swarmloom/packages/element
  ```

  Both link the folder instead of copying it, so keep the checkout in place and rebuild it after pulling changes.

Once the package is published, `npm install @swarmloom/element` replaces this step.

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

Without `src`, the component builds its own Light DOM children:

```html
<swarm-loom controls reduced-motion="auto">
  <article>
    <h1>Hello, swarm.</h1>
    <p>These elements become a Blueprint.</p>
  </article>
</swarm-loom>
```

The component snapshots the children once they are parsed and their web fonts and images have loaded. The children stay in the layout, so they set the element's height unless the page gives it one. The stage covers them during the build and is `aria-hidden`, so assistive technology still reads the real children; when the player goes live, the real, interactive children come back.

This is a subtree snapshot. It does not execute child scripts or clone application state. When `src` is set, the children are not shown and do not act as fallback content if the source fails.

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

## Script build <Badge type="info" text="Build from source" />

The build above also writes `dist/swarm-loom.global.js`, an IIFE build for pages without a bundler. When it loads, it registers `<swarm-loom>` and exposes `window.SwarmLoom` with `define`, `configure`, `SwarmLoomElement` and `TAG_NAME`.

```html
<script src="/vendor/swarmloom/swarm-loom.global.js"></script>
<swarm-loom src="/examples/intro.md" inview controls></swarm-loom>
```

The script contains the engine but no adapter code. The first source that needs an adapter loads `swarm-loom.adapters.js` and that adapter's chunk from `chunks/`, relative to the script URL; worker files such as the PDF parser load from `assets/`. Host the whole `dist/` folder together, and load the script as a classic `<script>` (without `type="module"`) so it can find its own URL.

`SwarmLoom.configure({ createPlayer, formats, maxBytes })` replaces the runtime shared by every element, for example to restrict formats or lower the download limit (50 MB by default). It applies to sources loaded after the call.

Once the package is on npm, unpkg and jsDelivr will serve the same file, for example `https://cdn.jsdelivr.net/npm/@swarmloom/element@<version>/dist/swarm-loom.global.js`. Pin the version in production; do not use an unpinned `latest` URL.

## Accessibility and performance

- Provide pause controls even when autoplay is enabled.
- Keep `reduced-motion="auto"` to respect the system preference.
- Use `inview` for below-the-fold instances to avoid offscreen work.
- Expect sound to require a user gesture; autoplay rejection is not exceptional.
- Each instance owns its stage and resources. Remove unused instances so long-lived pages do not accumulate them.
