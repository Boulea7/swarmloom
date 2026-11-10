---
title: CLI
description: The swarmloom render, snapshot, serve, formats and doctor commands.
---

# CLI

::: warning Current status
The CLI package has not been published. The current source supports only `--help` and `--version`; every subcommand reports “not implemented yet”. The commands and options below are the planned v1 interface fixed in the shell contract.
:::

The CLI drives local Chrome/Chromium frame by frame on a virtual clock, captures each frame, and passes the result to ffmpeg. It is intended for batch export, fixed-size recordings and reproducible builds.

## Requirements and installation

Once published, the planned invocation is:

```bash
npx swarmloom --help
npx swarmloom render ./demo.md -o demo.mp4
```

Or install globally:

```bash
npm install -g swarmloom
```

The CLI requires Node.js 20 or later. Source-workspace development requires Node.js 22.12 or later.

Video and animated-image encoding also require:

- Chrome or Chromium;
- A modern ffmpeg. PNG sequences do not need ffmpeg muxing.

The planned `swarmloom doctor` command checks both dependencies and prints fixes.

## Global options

| Option | Purpose |
| --- | --- |
| `-h, --help` | Show global or command help |
| `-v, --version` | Show the CLI version |
| `--quiet` | Hide render progress; errors still go to stderr |

## `render`

```text
swarmloom render <file|url> [-o out.mp4]
  [--format mp4|webm|gif|webp|png-seq]
  [--width 1280] [--height 720] [--scale 1] [--fps 30]
  [--agents auto] [--speed 1] [--seed 1]
  [--theme auto] [--labels names] [--finale flock]
  [--no-sound] [--tail 2500] [--max-duration 120]
  [--chrome <path>] [--ffmpeg <path>] [--quiet]
```

### Arguments and options

| Argument | Default | Description |
| --- | --- | --- |
| `<file\|url>` | Required | Local file or remote URL; quote paths containing spaces |
| `-o <path>` | `out.mp4` | Output file; use an output directory for PNG sequences |
| `--format <format>` | `mp4` | `mp4`, `webm`, `gif`, `webp` or `png-seq` |
| `--width <px>` | `1280` | Viewport and output width in CSS px |
| `--height <px>` | `720` | Viewport and output height in CSS px |
| `--scale <number>` | `1` | Device scale factor; changes pixel density, not CSS layout dimensions |
| `--fps <number>` | `30` | Frames per second; each frame advances `1000 / fps` ms |
| `--agents <n\|auto>` | `auto` | Cursor count; `auto` scales to the scene |
| `--speed <number>` | `1` | Build-speed multiplier; must be above 0 |
| `--seed <number>` | `1` | Random seed; reuse it with identical input and settings |
| `--theme <mode>` | `auto` | `auto`, `light` or `dark` |
| `--labels <mode>` | `names` | `names`, `agents`, `roles` or `none` |
| `--finale <mode>` | `flock` | `flock`, `halo` or `none` |
| `--no-sound` | Sound enabled | Disable the soundtrack and sound-event output |
| `--tail <ms>` | `2500` | Hold time after the build completes |
| `--max-duration <s>` | `120` | Maximum engine duration in seconds; prevents endless renders |
| `--chrome <path>` | Auto-discover | Chrome/Chromium executable |
| `--ffmpeg <path>` | Auto-discover | ffmpeg executable |
| `--quiet` | Off | Hide frame and ETA progress |

### Examples

Export a 1280×720, 30 fps MP4:

```bash
swarmloom render ./README.md -o readme.mp4
```

Export a silent WebM with a fixed seed:

```bash
swarmloom render https://example.com -o site.webm \
  --format webm --seed 42 --no-sound
```

Export a 2× PNG sequence for editing:

```bash
swarmloom render ./slides.pptx -o ./frames \
  --format png-seq --width 1920 --height 1080 --scale 2
```

Render at most 15 seconds with explicit tool paths:

```bash
swarmloom render ./model.glb -o model.mp4 \
  --max-duration 15 --chrome /path/to/chromium --ffmpeg /path/to/ffmpeg
```

## `snapshot`

```text
swarmloom snapshot <url|file> [-o blueprint.json] [--width 1280]
```

Convert a page or file into Blueprint JSON for layer inspection, adapter development or later playback.

| Argument | Default | Description |
| --- | --- | --- |
| `<url\|file>` | Required | Source to capture |
| `-o <path>` | `blueprint.json` | Output JSON file |
| `--width <px>` | `1280` | Layout and capture viewport width |

```bash
swarmloom snapshot https://example.com -o example.blueprint.json --width 1440
```

A Blueprint may contain page text and image references. Review it for sensitive content as carefully as the original before sharing.

## `serve`

```text
swarmloom serve [--port 0] [--open]
```

Serve the Studio build bundled with the CLI on the local machine.

| Option | Default | Description |
| --- | --- | --- |
| `--port <port>` | `0` | Listening port; `0` selects a free port |
| `--open` | Off | Open the default browser after startup |

```bash
swarmloom serve --port 4173 --open
```

This is a local workflow. Do not expose it directly as a public service for untrusted files.

## `formats`

```text
swarmloom formats
```

Print adapter IDs, labels, extensions and MIME types from the registry actually bundled in the current CLI. Treat this command as the authoritative list after new adapters land.

## `doctor`

```text
swarmloom doctor
```

Check browser and ffmpeg discovery, and print versions, paths and fixes for missing dependencies.

Browser discovery order:

1. `--chrome`;
2. `SWARMLOOM_CHROME`;
3. Common install paths on Windows, macOS and Linux;
4. An installed Playwright browser.

ffmpeg discovery order:

1. `--ffmpeg`;
2. `SWARMLOOM_FFMPEG`;
3. `PATH`;
4. The optional `ffmpeg-static` dependency.

```bash
SWARMLOOM_CHROME=/path/to/chromium \
SWARMLOOM_FFMPEG=/path/to/ffmpeg \
swarmloom doctor
```

## Output and exit codes

Normal progress, including frames and ETA, goes to stderr and does not contaminate file data. Planned exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Command or argument usage error |
| `2` | Missing browser, ffmpeg or another dependency |
| `3` | Parsing, rendering or encoding failure |

## Determinism

The CLI fixes viewport, DPR, seed and frame step, then waits for frame resources before capture. Sound events render offline to WAV and are muxed with the video.

Deterministic validation compares raw frames and PCM, not MP4/WebM bytes. Encoder versions, threads and platforms can change compressed bytes without changing the pictures or sound. Reproduction also requires the same input, CLI/adapters, browser, fonts, ffmpeg and export settings.
