# @swarmloom/adapter-terminal

The terminal adapter for SwarmLoom. It turns an asciinema recording (`.cast` v1, v2 or v3) into a terminal window that the swarm replays: keystrokes are typed at the recorded pace with key sounds, program output streams in, and a block caret blinks. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { terminalAdapter } from "@swarmloom/adapter-terminal";

const { blueprint, plugins } = await terminalAdapter.load({ text }, { document, width: 960, theme: "light" });
```

How it works:

- The cast is parsed line by line (v2 absolute times, v3 intervals, pretty-printed v1 documents). Bad headers, unsupported versions and oversized terminals are rejected with a `CastError`; malformed event lines are skipped and reported in `blueprint.truncated` (more than half malformed is an error).
- A timeline caps idle gaps (1.5 s, or the header's `idle_time_limit` when lower), fits the whole session into a 60 s budget, and tells keystrokes from output. With `i` events, input and its echo are keystrokes; without them, short echoes at human pace are treated as typing.
- The session is cut into steps of at most 6 s (and at every switch between typing and output). Each step is a custom layer chained to the previous one, so one weaver builds them in order and no task gets near the engine watchdog.
- Our own ANSI/VT emulator (`Screen`) replays the output: SGR 16/256/truecolor, bold, dim, italic, underline, inverse, strike; CR, LF, BS, tabs; cursor moves, erase line/screen, insert/delete, scroll regions, wide and combining characters, OSC titles. The alternate screen is handled minimally (a second buffer that restores the main screen) and noted on the screen layer (`meta.notes`).
- The window (frame, title bar, three dots, title) is built from ordinary layers. It shrinks to the rows and columns the session uses when nothing scrolled, wrapped or resized, and the font scales down to fit `ctx.width`.
- The `terminal` plugin (a fresh instance per `load()`) renders the screen and plays steps from engine time only, so exports are deterministic. Remounting a step (replay) rewinds the screen to that point.

The ANSI toolkit is also published on its own as `@swarmloom/adapter-terminal/ansi` (`ansiToHtml`, `stripAnsi`, `Screen`, the `LOOM_INK` and `LOOM_PAPER` palettes); the notebook adapter uses it for coloured outputs.

Options (`createTerminalAdapter`): `maxBytes` (32 MiB), `idleLimit`, `startLimit`, `maxDuration`, `speed`, `maxStep`, `maxStepEvents`, `fontSize` (14), `theme`, `fit` (true), `title`.

Limits: no mouse reporting, no sixel or image protocols, no double-width lines, no bracketed-paste semantics. Full-screen programs replay best-effort.

License: MIT.
