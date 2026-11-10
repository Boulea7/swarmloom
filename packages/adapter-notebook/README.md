# @swarmloom/adapter-notebook

The Jupyter notebook adapter for SwarmLoom. It reads `.ipynb` files (nbformat 4) and lays the cells out in one column under a prompt gutter. For each code cell the swarm draws the frame, types the code, clicks the prompt to run it, and then reveals the outputs. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { notebookAdapter } from "@swarmloom/adapter-notebook";

const { blueprint, plugins } = await notebookAdapter.load({ text }, { document, width: 960, theme: "light" });
```

How it works:

- The JSON is checked against the nbformat 4 shape. nbformat 3 and older files are refused with a hint to upgrade them in Jupyter. Cell types, output types and MIME bundles that cannot be drawn (widgets, for example) are skipped and counted in `blueprint.truncated`.
- **Markdown cells** are parsed with unified, remark-parse and remark-gfm, the same stack and versions as adapter-markdown. They support tables, task lists, strikethrough and footnotes, and fenced code is highlighted. `attachment:` images are resolved from the cell.
- **Code cells:**
  - The code is highlighted with highlight.js 11.12.0, the same version as adapter-code. It uses a private instance with Python, R, Julia, JavaScript, TypeScript, Bash, SQL, JSON, Scala and C++, plus the usual kernel aliases.
  - Token colours are inline styles from the SwarmLoom palette.
  - The execution count is shown as `In [n]:`.
- **Outputs:**
  - `stream` output (stdout, and stderr on a warm tint) and `error` tracebacks keep their ANSI colours. They go through `@swarmloom/adapter-terminal/ansi`, so CR progress bars collapse to their last frame. Pass `ansi: "strip"` for plain text.
  - `display_data` and `execute_result` are drawn from the first match in this order: `text/html`, then `image/png`, `image/jpeg` or `image/gif`, then `text/markdown`, then `text/plain` or `text/latex`. An HTML output that needs scripts loses to an image when one is present.
  - `execute_result` outputs get an `Out [n]:` prompt.
- **Safety:**
  - All HTML is sanitized with DOMPurify. An allowlist pass then enforces the same rules where DOMPurify cannot run, for example under happy-dom.
  - Removed: scripts, event handlers, forms, frames, style sheets, SVG and MathML.
  - Inline styles cannot position content, animate it or load URLs.
  - Only embedded PNG, JPEG and GIF data URLs load, sized from their headers. Remote images become a labelled placeholder, so a notebook never contacts other hosts.
- **Choreography:**
  - Layers are chained by `parent`: frame (box), then code (text, typed), then run (custom `notebook:run` layer), then outputs (fade, with images swept in).
  - The `notebook` plugin draws the run indicator. A weaver clicks the prompt, the prompt shows `[*]` with a progress line for a deterministic, output-dependent time (under 3 s, jittered with `agent.rng`), and then it settles on the execution count. After an error it settles in the error colour.
  - A cell that never ran keeps a static `In [ ]:` prompt.
- **Layout:** heights come from laying the HTML out in a hidden shadow root with the same style sheet the blueprint carries (`blueprint.css`). Without layout, as in DOM shims, they are estimated from the text.

Options (`createNotebookAdapter`):

| Option | Default |
| --- | --- |
| `maxBytes` | 64 MiB |
| `maxCells` | 500 |
| `maxOutputs` per cell | 24 |
| `maxImageChars` | 16 MiB of base64 |
| `maxTextChars` | 200 000 |
| `maxOutputLines` | 300 |
| `maxOutputHeight` | 1600 px; taller outputs are clipped |
| `ansi` | `"color"` (or `"strip"`) |

`ctx.maxLayers` drops whole cells.

Limits:

- No live kernel and no widgets.
- Math in markdown (`$...$`) is shown as source text. adapter-markdown's KaTeX path will cover this once the two renderers are shared.
- SVG outputs fall back to their text form.
- Cell metadata such as hidden inputs or collapsed outputs is ignored.

Dependencies:

| Package | License |
| --- | --- |
| `unified` | MIT |
| `remark-parse` | MIT |
| `remark-gfm` | MIT |
| `highlight.js` | BSD-3-Clause |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `@swarmloom/adapter-terminal` (ANSI only) | MIT |

License: MIT.
