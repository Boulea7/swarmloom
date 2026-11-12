---
title: Supported formats
description: How SwarmLoom turns pages, documents, animation, code, images and 3D models into rebuildable Blueprints.
---

# Supported formats

::: info Current status
Every format on this page has a working reader and opens in Studio and the CLI; `swarmloom formats` prints the current list. The sections below describe what each reader keeps, simplifies or leaves out.
:::

Every input becomes a format-neutral **Blueprint**: world dimensions, background, layers, reading order and any required plugins. The player works with layers and choreographies rather than the original file format.

Document formats generally follow **parse → safe HTML → fixed-width layout → DOM snapshot**. Vector, bitmap and 3D inputs use specialised pipelines. Large parsers load on demand instead of joining the default player path.

## Live web page DOM

**Input:** the extension's current tab, a selected element, or `SourceInput.element`.

The snapshot reads geometry, computed styles, text, images and open shadow roots. Containers are built first, followed by headings and body text. Repeated cards can become alt-dragged duplicates, and shared edges can produce guides.

Video, WebGL canvases, cross-origin iframes and other regions that cannot be decomposed reliably use screenshots or labelled media placeholders. Complex scripts are not executed as part of the rebuild.

Animated images hold still in the rebuild. An animated SVG (an `<img>`, or an inline `<svg>` with SMIL) loses its SMIL animation and its CSS animations stay on their first frame; an animated GIF, APNG, WebP or AVIF shows its first frame. An image runs its animation on the browser's own clock, so a video could not repeat it frame for frame. This covers `data:` URLs, and image files and `blob:` URLs from the page's own origin; once a CLI render goes live, animated `<img>` elements on the real page also hold their first frame. Cross-origin image files, icons inside a line of text and CSS backgrounds keep playing on their own.

This is a visual snapshot at one point in time, not a clone of application state. Form state, network state and event logic are not replayed. **Go live** returns to the original page.

## HTML and HTML animation

**Extensions:** `.html`, `.htm`, `.xhtml`

A full HTML document is sanitized and laid out in a sandboxed frame; a fragment is sanitized and laid out in the current theme. Both then use the DOM snapshot pipeline. HTML input never runs scripts, and there is no option to enable them. The network is limited to `https:` images and fonts (sent without a referrer); every other request is blocked, and a Studio setting turns that loading off. Relative resources need a correct base URL. Remote resources remain subject to CORS, permissions and site access controls.

CSS animation is frozen for the rebuild: finite animations at their end state, infinite ones at half a cycle. Go live resumes the original animations. When the host registers the keyframe timeline plugin (`anim:timeline`, from the Lottie adapter), up to six animated elements also get a small timeline bar with their keyframes in free space under or above them, built after the page. Script-driven and event-driven animation is not guaranteed to round-trip.

## Markdown

**Extensions:** `.md`, `.markdown`, `.mdown`, `.mkd`

The parser handles CommonMark and GFM: headings, paragraphs, lists, task states, tables, code, links, images and footnotes. Headings grow while typed, task boxes are checked, table grids appear before cells, and code is typed using precomputed syntax tokens.

Markdown has no intrinsic paper size or original font. SwarmLoom applies its own theme and fixed layout width rather than inventing source pagination. Raw HTML is treated as untrusted input. Maths is rendered with KaTeX, which loads only when a document contains formulas; Mermaid fences are shown as code.

## DOCX

**Extension:** `.docx`

The default pipeline aims to preserve styles by converting the document into safe, measurable HTML before emitting layers. Common paragraphs, headings, lists, tables, images, headers, footers and explicit page breaks participate in the build.

HTML layout is not Microsoft Word's live pagination engine. Without reliable pagination, content stays continuous rather than receiving invented page boundaries. Export a PDF from Word when exact layout matters.

Fonts missing on the device are replaced from one shared fallback table, also used for DOC, PPTX, XLSX and OpenDocument: metric-compatible open fonts where they exist (Calibri to Carlito, Cambria to Caladea, Arial to Liberation Sans, Times New Roman to Liberation Serif, SimSun to Noto Serif SC, Microsoft YaHei to Noto Sans SC, and the matching Noto faces for Traditional Chinese, Japanese and Korean). An installed original always wins, no font files are bundled, and substitutions are listed in the load notes.

If the styled renderer fails on a document, a built-in plain renderer takes over. It keeps headings, paragraphs, lists, tables, hyperlinks and page breaks, leaves out pictures, headers, footers and footnotes, and says so in the load notes.

## DOC (Word 97–2003)

**Extension:** `.doc`

The legacy binary DOC reader opens the compound file (CFB) in pure JavaScript and decodes the text through the piece table. Documents open in text mode: paragraphs, headings, lists, tables, headers and footers, footnotes and endnotes appear in the document's body font, on page sheets that break only at sections and explicit page breaks. Pictures, character formatting (fonts, sizes, colours, emphasis), text boxes, comments and floating shapes are left out, and the load notes say so.

Encrypted, corrupt or unsupported structures produce explicit errors. An RTF file saved with a `.doc` name is recognised by its content and opened with the RTF reader.

## PDF

**Extension:** `.pdf`

PDF uses a separate pipeline. PDF.js renders page bitmaps and supplies text items, images and drawing information. Text regions are then revealed from the same rendered bitmap, avoiding reflow-related changes to fonts, ligatures or CJK glyphs.

Simple paths and images can be traced or swept in first. Text reveals along its own direction. Multi-column reading order uses document structure when available and inference otherwise.

Scanned pages and outlined text have no text items, so they reveal by region or full-page sweep rather than pretending to type. OCR is not a first-release promise. Page count, pixels per page and drawing operations are limited; truncation, degradation or rejection is reported.

## SVG and SVG animation

**Extension:** `.svg`

A pen cursor places anchors, pulls curves and traces strokes, followed by fills, gradients and text. `<use>` instances can appear as duplicates. Groups and paint order are preserved in the Blueprint. A drawing that would be taller than a 16:9 frame at full width is fitted whole into the frame, so logos, badges and square charts finish fully in view; clearly portrait drawings (a long flow chart) keep the full width and scroll along with the build.

SMIL-animated SVG (`animate`, `animateTransform`, `animateMotion`, `set`, `mpath`) is first rebuilt as a static drawing. Once the weave is done, the animated drawing fades in and plays from 0 s; it follows player time while building, so exported videos stay frame-exact, and runs on its own clock after go live. CSS animations and transitions inside such a drawing follow the same timeline: they hold at 0 s until the replay starts and are seeked with it. An SVG animated only with CSS (no SMIL) is not replayed yet and shows its first frame. When the host registers the keyframe timeline plugin (`anim:timeline`), a timeline bar with the keyframes is built under the drawing before the animation plays. `href` may only point to `#fragment` targets inside the document. Scripts, external resources and interaction handlers are never executed.

## Slides

**Extension:** `.pptx` (`.odp` opens with the OpenDocument reader)

Each slide becomes a page on the stage with the presentation's own slide size, so 16:9, 4:3 and custom sizes keep their proportions. The reader takes the slide, its layout and master, and the theme into account: backgrounds, preset and custom shapes with fills, outlines and shadows, text with bullets, numbering and placeholder inheritance, cropped pictures and simple tables.

PPTX is the main parsing target. Legacy `.ppt` is not supported yet: opening one asks you to save it as `.pptx` or PDF. Charts, SmartArt, video and other embedded objects appear as labelled placeholders, and original PowerPoint animation is not replayed.

Keynote files are not read. Export PPTX or PDF from Keynote.

## Spreadsheets

**Extensions:** `.xlsx`, `.xlsm`, `.ods`, `.csv`, `.tsv`. Legacy `.xls` is not supported yet: opening one asks you to save it as `.xlsx` or CSV.

Sheets build through tabs, column letters, row numbers, grids, headers and data regions. Important cells can be typed; ordinary data appears in spatial tiles or fills. A large used range does not create one animation task per cell.

Formulas appear as text and cached values from the file. **SwarmLoom does not execute formulas, macros, DDE, external workbook links or network queries.** Missing cached values produce an expression and a notice, not an invented result. Charts are rebuilt only from understandable cached series; other types use a preview or data-table fallback.

CSV/TSV encoding and delimiter detection must be explainable. Ambiguous input asks for a choice, and a leading `=` remains text rather than becoming executable formula input.

## Source code and plain text

**Common extensions:** `.txt`, `.js`, `.jsx`, `.ts`, `.tsx`, `.json`, `.css`, `.scss`, `.py`, `.rb`, `.go`, `.rs`, `.java`, `.kt`, `.swift`, `.c`, `.cpp`, `.cs`, `.php`, `.sh`, `.sql`, `.yaml`, `.toml`, `.xml`, `.vue`, `.svelte`, `.lua`, `.dart`, `.scala` and others listed by `swarmloom formats`.

Syntax highlighting runs once during import. Cursors type tokens while preserving whitespace and monospace layout. Long files reveal by line or block instead of rerunning the highlighter every frame.

Source code is treated as text and never executed. Plain text has no reliable font or style information; ambiguous encodings require confirmation.

## More document and developer formats

| Format | Extensions | Rebuild |
| --- | --- | --- |
| EPUB | `.epub` | Turns the cover and chapters into safe pages in spine order |
| OpenDocument | `.odt`, `.ods`, `.odp`, `.odg`; templates `.ott`, `.ots`, `.otp`; Flat XML `.fodt`, `.fods`, `.fodp`, `.fodg` | Rebuilds text, sheets, slides and drawings without recalculating formulas |
| RTF | `.rtf` | Lays out paragraphs, character styles, tables and pictures as pages |
| OFD | `.ofd` | Rebuilds fixed-layout text, paths and images page by page without verifying signatures |
| Jupyter notebook | `.ipynb` | Rebuilds Markdown, code and output cells in order without a live kernel; Markdown cells use the Markdown adapter's renderer, formulas stay as TeX source |
| asciinema terminal recording | `.cast` | Replays recorded keystrokes and output with ANSI styling |
| Patch / diff | `.diff`, `.patch` | Builds review panels, strikes through removals and types additions |
| XMind / FreeMind mind map | `.xmind`, `.mm` | Draws topics and connectors on the first sheet from the root outwards |
| Lottie animation | `.lottie`, Lottie `.json` (found by content) | Weaves one frame as vector layers, drags out a keyframe timeline, then plays the animation on the player clock; expressions never run |

## Bitmap images

**Extensions:** `.png`, `.apng`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.avif`, `.bmp`

The bitmap pipeline extracts an edge sketch, paints spatial tiles, and finishes with the complete image. Cursors follow edges or painted regions rather than merely fading in the full bitmap.

Animated images use their first frame; resuming their timeline is a later enhancement. Very large images may be downsampled or tiled with an explicit notice.

## 3D models

**Extensions:** `.glb`, `.gltf`, `.obj`, `.stl`, `.ply`

The 3D adapter is a plugin with its own WebGL stage. Connected surface patches reveal vertices, feature edges and triangles, followed by materials, textures and lighting. A short camera orbit completes the build; afterwards the model can be rotated by dragging and zoomed with the wheel or a pinch.

GLB is the recommended single-file distribution. The reader reads only that one file and never loads companion files: a `.gltf` that references external `.bin` files or textures is rejected with a message to export a GLB or a glTF with embedded data, and OBJ `mtllib` materials and textures are not read (a palette is used and a note says so). Formats without standard units, such as STL, need unit or up-axis overrides.

Large models use deterministic LOD and sampling budgets. Reduced-motion mode shows a static final state without automatic orbit. Unavailable WebGL or an excessive model budget produces an explicit error or fallback.

## Export formats

The CLI's `render` command writes these formats (`swarmloom doctor` shows which ones the local ffmpeg supports):

| Format | Use | Audio |
| --- | --- | --- |
| MP4 | General sharing; H.264, `yuv420p`, fast start | Synchronised soundtrack |
| WebM | Browser and open-web workflows; VP9 / Opus | Synchronised soundtrack |
| GIF | Short legacy-compatible animation | No |
| Animated WebP | Smaller web animation | No |
| PNG sequence | Editing, compositing and frame validation | Separate WAV |

Studio's in-browser export runs the same render page and virtual clock as the CLI and writes MP4 (or WebM when the browser has no H.264 encoder). It draws frames from an SVG snapshot instead of a screenshot, so a few styles can differ; see [Studio](./studio#export-and-sharing). Use the CLI for the other formats and for reference output, and fix the seed, viewport, frame rate, theme and dependency versions.
