---
title: Getting started
description: Start with SwarmLoom through an extension, Studio or the source workspace.
---

# Getting started

::: info Current status
Studio is online: it opens files, plays them and exports video in the page. The extensions, the CLI and the `<swarm-loom>` element work when built from source; store listings and npm packages are not published yet.
:::

There are three ways to use SwarmLoom: rebuild a page in place, open content in Studio, or embed the player in your own project.

## Rebuild a web page <Badge type="info" text="Build from source" />

This is the best route for articles, documentation, landing pages and ordinary application screens.

1. Install the extension by following the [installation guide](./install).
2. Open a normal web page. Click the SwarmLoom toolbar icon or press <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>W</kbd>.
3. The page fades into a blank stage and the swarm starts building. Press Space to pause or resume, and <kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd> to change speed.
4. Press <kbd>M</kbd> for sound and <kbd>T</kbd> for automatic touring.
5. When the build completes, choose **Go live** or press <kbd>L</kbd> to return to the interactive page. Press <kbd>R</kbd> to replay.

Browser-privileged pages, extension stores and built-in PDF viewers do not allow injected rebuild scripts. Use **Open in Studio** or import the original file instead.

## Open a file in Studio

This route fits PDFs, Word documents, Markdown, source code, images and 3D models. It also works on mobile devices.

1. Open [SwarmLoom Studio](https://boulea7.github.io/swarmloom/studio/).
2. Drop a file, or choose **Open file**, **Paste** or **URL**.
3. Alternatively, choose an example to play immediately. Sound may need a click or tap before the browser unlocks audio.
4. Use the settings drawer to change cursors, speed, labels, theme, sound pack and finale.
5. Choose **Export** to make a video of the result in the page. Browsers that cannot encode video (no WebCodecs) show the equivalent CLI command instead.

Studio parses local files in your browser. Opening a remote URL makes a request to that URL's site.

## Embed it in your own page <Badge type="info" text="Build from source" />

Register the Web Component and give it a source:

```html
<swarm-loom
  src="/demo.md"
  type="markdown"
  agents="24"
  speed="1"
  theme="auto"
  labels="roles"
  autoplay
  controls
  sound
></swarm-loom>
```

For framework-independent JavaScript control, load a Blueprint through an adapter and pass it to `createPlayer()`. See [Web Component](./element) and [JavaScript API](./api) for complete examples.

## Start the development environment

The source workspace requires Node.js 22.12 or later.

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm dev:studio
```

This starts Studio's Vite development server with hot reload.

Run the documentation site locally with:

```bash
pnpm docs:dev
```

## Next steps

- [Install on browsers and devices](./install)
- [See how each format is built](./formats)
- [Learn shortcuts, follow modes, sound and export](./usage)
- [Use the CLI for deterministic exports](./cli)
