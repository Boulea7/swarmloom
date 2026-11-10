---
title: Usage
description: SwarmLoom shortcuts, settings, touring, sound, go-live, sharing and export.
---

# Usage

::: warning Current status
The player and toolbar are still being implemented. This page describes v1 interactions already fixed in the contracts. Refer to release notes for final availability.
:::

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>W</kbd> | Start or close extension rebuilding on a supported page |
| <kbd>Space</kbd> | Pause or resume |
| <kbd>M</kbd> | Toggle sound |
| <kbd>T</kbd> | Toggle automatic touring |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> | Set 1×, 2× or 3× speed |
| <kbd>R</kbd> | Replay from the beginning |
| <kbd>F</kbd> | Finish now: the remaining layers complete quickly (when the player supports it) |
| <kbd>L</kbd> | Go live: return to the original page or final static content |
| <kbd>Esc</kbd> | Close the player |

Shortcuts apply while the player has focus and no text field is being edited. Browser and operating-system shortcuts take precedence.

On touchscreens, tap an empty part of the stage to toggle the toolbar. Targets are at least 44 CSS px and avoid safe areas and available fold segments.

## Common settings

| Setting | Values | Recommendation |
| --- | --- | --- |
| `agents` | `auto` or an explicit count | Use `auto` to scale between 8 and 64 from layers and viewport; use fewer on phones |
| `speed` | Any multiplier above 0 | Start at 1×; try 2× or 3× for long documents |
| `labels` | `names`, `agents`, `roles`, `none` | Use `roles` for collaboration demos and `none` for a clean frame |
| `theme` | `auto`, `light`, `dark` | `auto` follows the system and content |
| `follow` | `scroll`, `tour`, `none` | Use `scroll` for reading, `tour` for video, `none` for a fixed frame |
| `finale` | `flock`, `halo`, `none` | Gather around the pointer, show an audio-reactive ring, or end directly |
| `reducedMotion` | `auto`, on, off | Keep `auto` to respect the system preference |
| `intro` | On or off | Disable it for small repeated embeds |

The JavaScript API also supports custom label arrays, palettes, locale, seed and clocks.

## Touring and manual scrolling

- `scroll`: the user controls scrolling and the swarm follows the active work area.
- `tour`: the stage scrolls at the build's pace for unattended playback and exports.
- `none`: no automatic scrolling, useful for one-screen posters, slides and models.

Long pages mount only nearby layers. A fast manual scroll prioritises newly visible content instead of insisting that every layer above it complete first.

## Sound

Effects are synthesised with Web Audio rather than downloaded recordings. Four sound packs are planned:

| Pack | Character |
| --- | --- |
| `studio` | Default; crisp keyboard and mouse sounds with pitched completion notes |
| `soft` | Quieter and softer |
| `8bit` | Retro digital timbres |
| `silent-keys` | Keeps interface and completion cues while muting keys |

Stereo pan follows cursor x. Notes can quantise to an eighth-note grid, with a default tempo of 112 BPM. Speed and pause use the same engine clock.

Browsers usually require a user gesture before audio starts. When **Tap for sound** appears, click the toolbar or stage. An autoplay block is not a damaged file.

The halo finale can respond to the synthesised track. Microphone input is optional and requires explicit permission; denial does not affect ordinary playback or export.

## Reduced motion

`reducedMotion: "auto"` reads `prefers-reduced-motion`. The reduced path uses quick cross-fades and skips flocking, orbit and large travel.

Reduced motion does not imply muted sound. The two preferences remain independent.

## Go live and replay

**Go live** behaves according to the player mode:

- **Overlay**: synchronises scroll, fades out the rebuilt stage, and restores the interactive original page.
- **Inline**: hides cursors and transient guides while retaining the final static content.

`replay()` resets reveal progress without fetching the input again. `destroy()` releases DOM, audio, listeners and plugin resources; call it when leaving the host view.

## Record in the browser <Badge type="warning" text="Planned" />

Where Region Capture and MediaRecorder are available, Studio's **Export** records WebM in real time with the Web Audio track:

1. Put the content in the layout and theme you want to capture.
2. Choose **Export**, then select the current tab and recording region when the browser prompts.
3. Start playback, stop at the end, and save the WebM.

This is wall-clock recording and can vary with machine load. Unsupported browsers show the equivalent CLI command rather than pretending to produce an equivalent file.

For deterministic output, use the [CLI](./cli). A virtual clock advances by `1000 / fps` milliseconds per capture, and the same sound-event log is rendered offline to WAV before muxing.

## Share <Badge type="warning" text="Planned" />

Small Markdown, SVG and code inputs can be compressed into the `#d=` URL hash. Large files and remote URLs use file import or `?src=` instead.

**The link may contain the original text.** Check it for secrets, private information, unpublished documents and copyrighted material before sharing. Recipients can read its content, and remote sites may keep their own access logs.
