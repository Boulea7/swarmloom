---
title: CLI
description: The swarmloom render, snapshot, serve, formats and doctor commands.
---

# CLI

::: warning Current status
`render`, `snapshot`, `serve`, `formats` and `doctor` are implemented, but the `swarmloom` npm package has not been published yet, so for now you build it from source. The output of `swarmloom <command> --help` is the reference for each command's options.
:::

The CLI drives local Chrome/Chromium frame by frame on a virtual clock, captures each frame, and passes the result to ffmpeg. It is intended for batch export, fixed-size recordings and reproducible builds.

## Requirements and installation

Build from source (Node.js 22.12 or later):

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm build
node apps/cli/dist/cli.js --help
```

`pnpm build` bundles the render page, the snapshot script and Studio into `apps/cli/dist/`. In a source checkout, read `swarmloom` below as `node apps/cli/dist/cli.js`.

Once the npm package is published you can run it directly or install it globally; the CLI itself then needs only Node.js 20 or later:

```bash
npx swarmloom render ./demo.md -o demo.mp4
npm install -g swarmloom
```

Rendering also needs:

- A Chromium-based browser: Chrome, Chromium, Edge or Brave. The CLI never downloads a browser itself. The Chrome Headless Shell that matches the `playwright-core` version is recommended, because it renders the same frames on every machine;
- ffmpeg 4 or later for MP4, WebM, GIF and WebP. PNG sequences do not need ffmpeg.

Run `swarmloom doctor` to check these and print the exact install commands and fixes.

## Global options

| Option | Purpose |
| --- | --- |
| `-h, --help` | Show the global help; `swarmloom <command> --help` or `swarmloom help <command>` shows a command's help |
| `-v, --version` | Show the CLI version |

Without arguments the help goes to stderr and the exit code is 1. `--quiet` and `--verbose` belong to `render` and `snapshot`; they are not global options, and `swarmloom --quiet ...` is rejected.

## `render`

```text
swarmloom render <file|url> [options]
```

Render a file or web page to a video of the swarm building it, with sound by default. Frames are captured one by one on a virtual clock, so the result does not depend on machine speed.

### Output

| Option | Default | Description |
| --- | --- | --- |
| `<file\|url>` | Required | Local file or `http(s)` URL; quote paths containing spaces. See [`formats`](#formats) for the file types |
| `-o, --output <path>` | `<input name>.<format>` | Output file, written to the current directory by default. `png-seq` writes a directory, `<input name>-frames` by default. For URLs the input name is the host name plus the last path segment |
| `-f, --format <format>` | From the `--output` extension, else `mp4` | `mp4`, `webm`, `gif`, `webp` or `png-seq`. When neither is given and no ffmpeg is found, it falls back to `png-seq` with a warning |
| `--width <px>` | `1280` | Viewport width in CSS px, 16–7680 |
| `--height <px>` | `720` | Viewport height in CSS px, 16–7680 |
| `--scale <n>` | `1` | Pixels per CSS px; the video is width and height times this value, 0.25–4. Neither side may exceed 8192 px |
| `--fps <n>` | `30` | Frames per second, 1–120; frame n shows `n * 1000 / fps` ms. The player always takes 120 steps a second, so rates that divide 120 (15, 24, 30, 60, ...) film the same build, only sampled more or less often; rates such as 25 or 50 give a slightly different build |
| `--max-duration <s>` | `120` | Stop the video at this many seconds, 1–3600 (at most 600 with sound); warns when the build has not finished |
| `--duration <s>` | Off | Exact video length, 0.1–3600 s (at most 600 with sound): keeps capturing the finale and the finished page after the build, and cuts an unfinished build there; not together with `--max-duration` |

Encodings: `mp4` is H.264 + AAC, `webm` is VP9 + Opus, `gif` and `webp` are silent animations. `png-seq` writes into a missing or empty directory, numbering frames from `frame-000001.png`, with the sound in `audio.wav` (not written with `--no-sound`).

### Swarm

| Option | Default | Description |
| --- | --- | --- |
| `--agents <n\|auto>` | `auto` | Number of cursors, 1–256; `auto` scales to the scene |
| `--speed <n>` | `1` | Build-speed multiplier, 0.05–16 |
| `--seed <n>` | `1` | Random seed, 0–4294967295; the same input, settings and seed give the same video |
| `--theme <theme>` | `auto` | `auto`, `light` or `dark` |
| `--labels <mode>` | `names` | `names`, `agents`, `roles` or `none` (`none` also hides status bubbles such as "running") |
| `--overlays <level>` | `full` | Editing marks drawn while building. `minimal` hides size badges, distance labels, guide lines and rulers; `none` also hides selections, frames, pen lines, carets and status bubbles, leaving the cursors, their name tags and the content |
| `--finale <finale>` | `flock` | `flock`, `halo` or `none` |
| `--follow <mode>` | `tour` | `tour` scrolls the page along with the build; `none` does not scroll |
| `--opening <time>` | Off | Show the finished page or document first for `<time>` (seconds, milliseconds or beats, as for `--cue`; at most 60 s), then fade it into the blank canvas and start the build. The fade starts on `<time>` exactly and takes 0.52 s |
| `--intro <style>` | `warp` | `warp`: the cursors circle the file icon, then fan out; `outline`: up to three cursors (fewer with a smaller `--agents`) first draw the largest shapes in view, two each, then the rest joins to fill in the details; `none`: no intro |
| `--tail <ms>` | `2500` (`3700` with `--live-top`) | Hold time after the build finishes, 0–60000 ms: the finale, then the page goes live, the cursors leave and the page's own animations (CSS, SVG SMIL, Lottie) play on video time; an HTML document swaps in the real page, its animated images held on their first frame. A go live still under way when it ends (cursors leaving, the glide back to the top) runs on until the page shows |
| `--no-live` | Go live | Keep the finale through the whole tail instead of going live |
| `--live-top` | Off | Going live glides back to the top of the page (up to 1.2 s) while the cursors leave, so the live page starts at its first screen |
| `--locale <tag>` | `en-US` | Language of the toolbar strings and the page, a BCP 47 tag such as `zh-CN` |
| `--bpm <n>` | `112` | Tempo the placement notes, the fan-out and the final chord snap to (eighth-note grid), 40–240 |
| `--beat-sync <set>` | `notes` | `notes` or `all`. `all` also puts keys, clicks, snaps and pen anchors on the nearest sixteenth note (at most 30 ms early or 60 ms late, one per sound and sixteenth) and leaves out the ones farther off |
| `--cue <at>:<action>` | None | Player action at a fixed video time; repeatable. `<at>` is seconds (`12.5`), milliseconds (`12500ms`) or beats at `--bpm` (`26b`, needs an explicit `--bpm`); `<action>` is `pause` (every cursor holds), `resume`, `finish` (complete the build quickly), `live` (go live then instead of when the finale settles, also with `--no-live`; an unfinished build completes at once) or `speed=<n>` (build speed from then on, 0.05–16; `--cue 0:speed=2 --cue 17b:speed=1` hurries only the start). Applied at the first engine step (1/120 s) at or after `<at>`, so every frame rate that divides 120 applies it at the same time; at other rates (25, 50, ...) the player also steps to each frame time, and a frame time that comes before that engine step applies it instead. Either way it shows from the first frame at or after `<at>`; same-time cues run in the order given; `<at>` must be before the end of the video |
| `--no-sound` | Sound on | Leave out the soundtrack; GIF and WebP never have one |
| `--no-remote` | Loaded | Do not load `https:` images and fonts the input links to. Scripts, style sheets, data requests and `http:` files from other sites are never loaded |
| `--terminal-font <mode>` | `fit` | Font size of terminal recordings (`.cast`). `fit` uses 14 px and shrinks it when the window does not fit; `fill` grows it until the window fills the frame's width or height (the window frame keeps its size). The stage already enlarges a small window up to 2x, so `fill` mostly helps short sessions with few columns and rows |

### Capture evidence

For takes that can be checked and repeated. These files and `--output` must all be different, and none of them may be the input file (also through a link).

| Option | Default | Description |
| --- | --- | --- |
| `--audio-out <file>` | Off | Also write the soundtrack as WAV (48 kHz stereo, same length as the video); needs sound, so not with `--no-sound`, GIF or WebP |
| `--events-out <file>` | Off | Also write the sound log as JSON: engine ms on the frames' clock, with each event's frame number and `at`, when the soundtrack plays it (on the beat grid; `null` when it stays silent). `scrolls` lists each stretch of scrolling (the tour, a `--live-top` glide) on the same clock: `t` and `end` with their frames `frame` and `endFrame`, and the view's top edge `from` and `to` in the page's CSS px |
| `--manifest-out <file>` | Off | Write a capture manifest: arguments, input and blueprint SHA-256 (the blueprint's addresses that change per run, such as the served input path, links resolved against the render page and `blob:` URLs, are normalized first), player settings, cues, browser/ffmpeg/Node versions, fonts used, and the SHA-256 of every frame and of the sound log; frames are then captured as PNG so the hashes describe exact pixels. It is meant to be shared: file paths, in the arguments and the outputs, are relative to the manifest (a file neither in its folder nor in a folder above it appears by name only), programs appear by file name, the working directory is left out, and URL user info, query and fragment read `redacted` |

### Programs and logging

| Option | Default | Description |
| --- | --- | --- |
| `--chrome <path>` | Auto-detect | Chrome/Chromium/Edge/Brave executable; see [`doctor`](#doctor) for the search order |
| `--ffmpeg <path>` | Auto-detect | ffmpeg 4+ executable |
| `--require-sandbox` | Off | Fail when the browser's sandbox does not start (as root, or with user namespaces turned off, as in many containers) instead of running the browser without it |
| `-q, --quiet` | Off | Errors only: no progress, warnings or summary. The warning that the browser runs without its sandbox still shows |
| `--verbose` | Off | Echo the render page's console and every blocked request to stderr |

### Examples

Export a 1280×720, 30 fps MP4:

```bash
swarmloom render ./README.md -o readme.mp4
```

Without `-o`, this writes `README.mp4` in the current directory:

```bash
swarmloom render ./examples/README.md
```

Export a silent WebM with a fixed seed:

```bash
swarmloom render https://example.com -o site.webm --seed 42 --no-sound
```

Export a 15 fps, 960×540 GIF:

```bash
swarmloom render ./deck.pptx -o deck.gif --fps 15 --width 960 --height 540
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

Render exactly 24 seconds, hold on beat 26, finish on beat 28 and keep evidence that can be checked later:

```bash
swarmloom render ./logo.svg -o take.mp4 --duration 24 --bpm 90 \
  --cue 26b:pause --cue 28b:resume --cue 28b:finish \
  --audio-out take.wav --events-out events.json --manifest-out manifest.json
```

## `snapshot`

```text
swarmloom snapshot <url|file.html> [options]
```

Capture a web page as Blueprint JSON that the player, `<swarm-loom>` and Studio can replay, or use it to inspect layers and develop adapters. Use `render` for documents, images and other files.

Local HTML files are treated as untrusted:

- The page's own scripts do not run; the capture shows what its HTML and CSS produce;
- Only the file itself and the images, fonts, style sheets, media and similar assets next to it (subfolders included) are served, the same set `render` serves. Other files in that folder, dotfiles such as `.env`, and symlinks that point outside the folder or at such files are not;
- From other sites only `https:` images and fonts load. Every other request is blocked; the CLI reports how many, and `--verbose` lists each one.

Web page URLs run their scripts as usual.

Before the capture, the page is scrolled through once, so lazy content loads and reveal-on-scroll effects start. Then its CSS animations and transitions are stopped in a fixed pose: finite ones at their end, endless ones half a cycle in, so two captures of the same page match. Videos that play or are set to autoplay pause the same way: looping ones halfway through, others at their end (on their first frame when the server does not accept range requests). `render` of a URL captures the same way. Animations that start after that and animation done by scripts are captured as they are.

| Option | Default | Description |
| --- | --- | --- |
| `<url\|file.html>` | Required | An `http(s)` URL, or a local `.html`, `.htm` or `.xhtml` file |
| `-o, --output <file>` | `blueprint.json` | Output file; `-` writes to stdout |
| `--width <px>` | `1280` | Viewport width in CSS px, 16–7680 |
| `--height <px>` | `720` | Viewport height in CSS px, 16–7680 |
| `--chrome <path>` | Auto-detect | Browser executable |
| `--require-sandbox` | Off | Fail when the browser's sandbox does not start instead of running the browser without it |
| `-q, --quiet` | Off | Errors only. The warning that the browser runs without its sandbox still shows |
| `--verbose` | Off | Echo the page's console and every blocked request to stderr |

```bash
swarmloom snapshot https://example.com -o example.blueprint.json --width 1440
swarmloom snapshot ./examples/html/landing.html -o - > page.json
```

A Blueprint may contain page text and image references. Review it for sensitive content as carefully as the original before sharing.

## `serve`

```text
swarmloom serve [--port 0] [--host 127.0.0.1] [--open]
```

Serve the Studio build bundled with the CLI on this machine. The address goes to stdout; stop it with Ctrl+C.

| Option | Default | Description |
| --- | --- | --- |
| `--port <n>` | `0` | Listening port; `0` picks a free port |
| `--host <addr>` | `127.0.0.1` | Interface to bind; the default allows this machine only |
| `--open` | Off | Open Studio in the default browser after startup |

```bash
swarmloom serve --port 4173 --open
```

Binding to a non-loopback address prints a warning, because other machines on the network can then open Studio. This is a local workflow. Do not expose it directly as a public service for untrusted files.

## `formats`

```text
swarmloom formats [--json]
```

List the input formats SwarmLoom can build, with label, ID and extensions; the last row is the web page (`dom`), which takes any `http(s)` URL. The list comes from the format registry actually bundled in the CLI; treat its output as authoritative.

```text
FORMAT                 ID        EXTENSIONS
Markdown               markdown  .md .markdown .mdown .mkd
HTML                   html      .html .htm .xhtml
…
Web page               dom       any http(s) URL
```

`--json` prints a JSON array of `id`, `label`, `extensions` and `mime` for scripts.

## `doctor`

```text
swarmloom doctor [--chrome <path>] [--ffmpeg <path>]
```

Check the Node.js version, whether the browser starts, the ffmpeg version and which video formats this machine can export, and confirm that the render page, the snapshot script and Studio are bundled. Missing items come with a fix. `--chrome` and `--ffmpeg` check the given executable instead of the auto-detected one.

The exit code is 0 when Node.js 20+, the browser, ffmpeg and the render page all work, and 2 otherwise. A missing snapshot script or Studio is only a warning.

Browser discovery order:

1. `--chrome`;
2. `SWARMLOOM_CHROME`;
3. chromium-headless-shell in the Playwright browser cache (honours `PLAYWRIGHT_BROWSERS_PATH`);
4. Installed Chrome, Chromium, Edge or Brave: `CHROME_PATH`, commands on `PATH` on Linux, then each system's default install locations, with snap packages last;
5. Playwright's full Chromium build.

When `--chrome` or `SWARMLOOM_CHROME` points to a missing file, the CLI stops with an error instead of searching further. When nothing is found, `doctor` suggests `npx playwright@<playwright-core version> install chromium-headless-shell`.

ffmpeg discovery order:

1. `--ffmpeg`;
2. `SWARMLOOM_FFMPEG`;
3. `ffmpeg` on `PATH`; versions older than 4 are skipped;
4. An `ffmpeg-static` package you installed yourself.

The CLI does not ship ffmpeg; install it yourself.

```bash
SWARMLOOM_CHROME=/path/to/chromium \
SWARMLOOM_FFMPEG=/path/to/ffmpeg \
swarmloom doctor
```

## Output and exit codes

Progress goes to stderr and never mixes with file data: a progress bar with the time left on terminals (a narrow terminal keeps the percent and time left first, shortens the bar and leaves out whole fields such as the frame count, so the line never wraps; the opening `Rendering ...` and closing `Wrote ...` lines break between fields), one line per quarter otherwise. The first Ctrl+C stops the render, closes the browser, stops ffmpeg and removes temporary files; a second one exits at once. The CLI only ends processes it started. With `SWARMLOOM_DEBUG=1`, unexpected errors include a stack trace.

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Usage error: invalid arguments, or a missing or unsupported input |
| `2` | Missing dependency: no browser, no usable ffmpeg or encoder, or a bundled page is missing |
| `3` | Render failure: the page, the browser or ffmpeg failed |
| `130` | Interrupted by Ctrl+C or SIGTERM |

## Determinism

The CLI fixes viewport, DPR, seed and frame step. Determinism comes from the player's own virtual clock: each frame advances `1000 / fps` ms (the player moves in 120 steps a second within it, whatever the frame rate) and is captured once it is ready and the page has painted it in its next animation frame; at a `--scale` other than 1, 2 or 4 the page also waits for the animation frame after that, by which time the browser has rastered the step (about 17 ms more per frame). BeginFrame control is not used. (A screenshot taken before the browser had rastered the frame could draw rounded corners and other anti-aliased edges a shade differently between runs, at scales such as 0.5, 2.5 or 3.) After the last frame the clock runs on to the end of the video without a capture, so the sound log covers the last frame's interval too. Sound events render offline to WAV, are padded with silence or cut to the video length, and are then muxed; muxing does not use `-shortest`, so audio and video have the same length.

Deterministic validation compares raw frames and PCM, not MP4/WebM bytes; the per-frame PNG hashes and the sound log hash that `--manifest-out` records can be compared across two runs directly. Encoder versions, threads and platforms can change compressed bytes without changing the pictures or sound. MP4 and WebM files carry no wall-clock date or random IDs, so with the same ffmpeg on the same machine the output hashes in the manifest normally match too. Reproduction also requires the same input, CLI/adapters, browser, fonts, ffmpeg and export settings.
