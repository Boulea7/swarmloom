---
title: Performance
description: SwarmLoom rendering budgets, virtualisation, resource management and performance troubleshooting.
---

# Performance

::: info Measurement status
The numbers on this page are design budgets. `pnpm bench` measures snapshot time, frame rate, long tasks, stage nodes and heap on a demo page and a synthetic page of about 4,400 layers and checks looser regression budgets; the scenarios and the latest results are on [Benchmarks](./benchmarks.md). Those results come from one shared Linux machine and do not prove the targets on every device.
:::

## Design budgets

The first-release target for a mid-range laptop is **48 cursors and about 4000 layers at more than 55 fps**, with a script budget of at most 6 ms per frame. Mobile devices and large 3D scenes use lower concurrency and resource budgets.

These targets need verification with fixed browsers, fonts, viewport, DPR, samples and build versions. Without those conditions, an isolated FPS number is not comparable.

## How the engine controls cost

### One cursor canvas

Cursors, name tags, status bubbles, selections and measurements are planned on one overlay canvas rather than dozens of DOM nodes updated every frame. Content layers remain separate from transient guides.

### Viewport virtualisation

Layers mount only within roughly 1.5 viewports of the visible area. Distant layers with no active work unmount while the engine retains their task state.

Snapshots default to at most 6000 layers and a world height of 60000 CSS px. Reaching a limit sets `Blueprint.truncated` and reports why; content is not dropped silently.

The snapshot walk runs in slices of about 10 ms, so the page stays responsive and `signal` takes effect within one slice. If the page reflows content that was already walked between two slices (an image or font loads, a timer grows a banner), the walk starts over; after two torn walks the last one runs in a single task, so the result always reflects one layout. Subtrees that start below `maxHeight`, and everything after about twice `maxLayers` layers, are only skimmed for fixed and absolutely positioned elements, without reading text or box styles. A long page therefore costs about as much as the part that is kept, not the whole DOM.

### Batched reads and writes

Geometry reads and style writes are batched to avoid layout thrashing. Final geometry is settled before playback. Reveal uses transforms, clipping or draw progress rather than reflowing the full document.

### Spatial-hash flocking

The flock finale uses a spatial hash to find neighbours rather than comparing every cursor with every other cursor. Cursor counts stay bounded as task counts grow.

### Lazy loading

PDF, Office, 3D decoders, maths and charting dependencies load only for matching inputs. Playing an existing Blueprint does not rerun its original compiler.

## Recommendations for large inputs

- Prefer PDF for fixed document layout instead of repeatedly fighting complex DOCX pagination.
- Split very long Markdown and source files by chapter or file. Keep truncation notices for complete long-page captures.
- Use tiled fills rather than per-cell typing for large sheets; do not create one task per cell.
- Resize bitmaps to their actual display needs instead of decoding images far larger than the output.
- Prefer single-file GLB, compressed textures and fixed LOD for 3D. Never turn each triangle into a DOM layer.
- Decode remote resources before playback so network completion cannot change layout or export ordering.

## When interactive playback stutters

1. Change a high fixed `agents` count to `auto`, or lower it manually.
2. Keep `reducedMotion: "auto"`; use `finale: "none"` when no finale is needed.
3. Disable unnecessary labels and toolbar animation to reduce overdraw.
4. Lower the output viewport and `--scale`. A 2× DPR produces roughly four times as many pixels.
5. Check for huge images, complex shadows, filters, video and high-poly models.
6. Close other demanding tabs and use the browser Performance panel to locate long tasks.

A higher `speed` shortens the run but does not necessarily reduce per-frame cost. It is not a substitute for simplifying the scene.

## Background tabs and pause

`RealtimeClock` clamps a single tick interval to 100 ms by default. Background throttling or a debugger pause does not make the engine jump through the entire build.

`pause()` stops engine time. Resume continues from the same state without catching up on wall-clock time spent paused.

## Performance rules for deterministic export

Export does not adapt LOD, cursor count or reveal order to instantaneous FPS. It advances by exactly `1000 / fps` milliseconds and awaits `player.ready()` before capture.

A slower machine may therefore take longer to export without producing a different scene. Encoder speed must not affect the engine timeline.

## Reporting a performance problem

A comparable report includes:

- SwarmLoom, browser and operating-system versions;
- CPU, memory, GPU and device type;
- Viewport width, height and DPR;
- Cursor count, layer count, input format and a minimal sample;
- Whether sound, halo, 3D and reduced motion are enabled;
- Performance trace, long tasks and peak memory;
- Expected and actual results.

Do not upload private source documents or full profiles. Create a minimal, redacted reproduction first.

## Benchmark command

```bash
pnpm bench
```

It runs the benchmark scenarios in headless Chromium and exits with status 1 when a regression budget fails. Run it alone on an idle machine; options, budgets and the latest results are on [Benchmarks](./benchmarks.md).
