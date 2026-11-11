---
title: Supported formats
description: How SwarmLoom turns pages, documents, animation, code, images and 3D models into rebuildable Blueprints.
---

# Supported formats

::: warning Current status
The format registry is defined, but adapters are still being implemented. This page describes the intended v1 pipelines and fidelity limits. All input support listed here is planned.
:::

Every input becomes a format-neutral **Blueprint**: world dimensions, background, layers, reading order and any required plugins. The player works with layers and choreographies rather than the original file format.

Document formats generally follow **parse → safe HTML → fixed-width layout → DOM snapshot**. Vector, bitmap and 3D inputs use specialised pipelines. Large parsers load on demand instead of joining the default player path.

## Live web page DOM

**Input:** the extension's current tab, a selected element, or `SourceInput.element`.

The snapshot reads geometry, computed styles, text, images and open shadow roots. Containers are built first, followed by headings and body text. Repeated cards can become alt-dragged duplicates, and shared edges can produce guides.

Video, WebGL canvases, cross-origin iframes and other regions that cannot be decomposed reliably use screenshots or labelled media placeholders. Complex scripts are not executed as part of the rebuild.

This is a visual snapshot at one point in time, not a clone of application state. Form state, network state and event logic are not replayed. **Go live** returns to the original page.

## HTML and HTML animation

**Extensions:** `.html`, `.htm`, `.xhtml`

HTML strings and URLs are planned to load in an isolated sandbox, then use the DOM snapshot pipeline. HTML input never runs scripts, and there is no option to enable them. The network is limited to `https:` images and fonts (sent without a referrer); every other request is blocked, and a Studio setting turns that loading off. Relative resources need a correct base URL. Remote resources remain subject to CORS, permissions and site access controls.

CSS animation is frozen for the rebuild: finite animations at their end state, infinite ones at half a cycle. Go live resumes the original animations. When the host registers the keyframe timeline plugin (`anim:timeline`, from the Lottie adapter), up to six animated elements also get a small timeline bar with their keyframes in free space under or above them, built after the page. Script-driven and event-driven animation is not guaranteed to round-trip.

## Markdown

**Extensions:** `.md`, `.markdown`, `.mdown`, `.mkd`

The planned parser handles CommonMark and GFM: headings, paragraphs, lists, task states, tables, code, links, images and footnotes. Headings grow while typed, task boxes are checked, table grids appear before cells, and code is typed using precomputed syntax tokens.

Markdown has no intrinsic paper size or original font. SwarmLoom applies its own theme and fixed layout width rather than inventing source pagination. Raw HTML is treated as untrusted input. Maths, Mermaid and additional highlighting languages are separate lazy-loaded enhancements.

## DOCX

**Extension:** `.docx`

The default pipeline aims to preserve styles by converting the document into safe, measurable HTML before emitting layers. Common paragraphs, headings, lists, tables, images, headers, footers and explicit page breaks participate in the build.

HTML layout is not Microsoft Word's live pagination engine. Without reliable pagination, content stays continuous rather than receiving invented page boundaries. Export a PDF from Word when exact layout matters.

Fonts missing on the device are replaced from one shared fallback table, also used for DOC, PPTX, XLSX and OpenDocument: metric-compatible open fonts where they exist (Calibri to Carlito, Cambria to Caladea, Arial to Liberation Sans, Times New Roman to Liberation Serif, SimSun to Noto Serif SC, Microsoft YaHei to Noto Sans SC, and the matching Noto faces for Traditional Chinese, Japanese and Korean). An installed original always wins, no font files are bundled, and substitutions are listed in the load notes.

A semantics-first simplified mode is planned for long documents and accessibility. It is not intended for precise style comparisons.

## DOC (Word 97–2003)

**Extension:** `.doc`

The legacy binary DOC pipeline is planned around CFB and the WordDocument stream. It extracts body text and paragraphs into simplified HTML. The first version prioritises text, not original table geometry, image positions, exact fonts or pagination.

Encrypted, corrupt or unsupported structures produce explicit errors. An RTF file saved with a `.doc` name is recognised by its content and opened with the RTF reader.

## PDF

**Extension:** `.pdf`

PDF uses a separate pipeline. PDF.js renders page bitmaps and supplies text items, images and drawing information. Text regions are then revealed from the same rendered bitmap, avoiding reflow-related changes to fonts, ligatures or CJK glyphs.

Simple paths and images can be traced or swept in first. Text reveals along its own direction. Multi-column reading order uses document structure when available and inference otherwise.

Scanned pages and outlined text have no text items, so they reveal by region or full-page sweep rather than pretending to type. OCR is not a first-release promise. Page count, pixels per page and drawing operations are limited; truncation, degradation or rejection is reported.

## SVG and SVG animation

**Extension:** `.svg`

A pen cursor places anchors, pulls curves and traces strokes, followed by fills, gradients and text. `<use>` instances can appear as duplicates. Groups and paint order are preserved in the Blueprint.

SMIL-animated SVG (`animate`, `animateTransform`, `animateMotion`, `set`, `mpath`) is first rebuilt as a static drawing. Once the weave is done, the animated drawing fades in and plays from 0 s; it follows player time while building, so exported videos stay frame-exact, and runs on its own clock after go live. CSS animation inside an SVG is not replayed yet (the first frame is shown). When the host registers the keyframe timeline plugin (`anim:timeline`), a timeline bar with the keyframes is built under the drawing before the animation plays. `href` may only point to `#fragment` targets inside the document. Scripts, external resources and interaction handlers are never executed.

## Slides

**Extension:** `.pptx` (`.odp` opens with the OpenDocument reader)

Each slide is planned as a stage section: background, master placeholders and guides first, then shapes and connectors, typed headings and body text, swept images, and finally tables, charts and slide numbers.

PPTX is the main parsing target. Legacy `.ppt` is not supported yet: opening one asks you to save it as `.pptx` or PDF. SmartArt, OLE, complex media and original PowerPoint animation may use snapshots, placeholders or explicit degradation.

Native Keynote object graphs are not a first-release promise. Export PPTX or PDF from Keynote. An iWork file with a reliable preview PDF can use the PDF pipeline.

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
| OpenDocument | `.odt`, `.ods`, `.odp`, `.odg` and corresponding Flat XML | Rebuilds text, sheets, slides and drawings without recalculating formulas |
| RTF | `.rtf` | Lays out paragraphs, character styles, tables and pictures as pages |
| OFD | `.ofd` | Rebuilds fixed-layout text, paths and images page by page without verifying signatures |
| Jupyter notebook | `.ipynb` | Rebuilds Markdown, code and output cells in order without a live kernel; Markdown cells use the Markdown adapter's renderer, formulas stay as TeX source |
| asciinema terminal recording | `.cast` | Replays recorded keystrokes and output with ANSI styling |
| Patch / diff | `.diff`, `.patch` | Builds review panels, strikes through removals and types additions |
| XMind / FreeMind mind map | `.xmind`, `.mm` | Draws topics and connectors on the first sheet from the root outwards |

## Bitmap images

**Extensions:** `.png`, `.apng`, `.jpg`, `.jpeg`, `.jfif`, `.gif`, `.webp`, `.avif`, `.bmp`

The bitmap pipeline is planned to extract an edge sketch, paint spatial tiles, and finish with the complete image. Cursors follow edges or painted regions rather than merely fading in the full bitmap.

Animated images use a deterministic representative frame by default; resuming their timeline is a later enhancement. Very large images may be downsampled or tiled with an explicit notice.

## 3D models

**Extensions:** `.glb`, `.gltf`, `.obj`, `.stl`, `.ply`

The 3D adapter is planned as a plugin with its own WebGL stage. Connected surface patches reveal vertices, feature edges and triangles, followed by materials, textures and lighting. A short camera orbit completes the build.

GLB is the recommended single-file distribution. OBJ MTL files and textures, and glTF `.bin` files and textures, must resolve. Missing resources are listed instead of triggering silent network guesses. Formats without standard units, such as STL, need unit or up-axis overrides.

Large models use deterministic LOD and sampling budgets. Reduced-motion mode shows a static final state without automatic orbit. Unavailable WebGL or an excessive model budget produces an explicit error or fallback.

## Export formats

Export is still being implemented. These are the target formats:

| Format | Planned use | Audio |
| --- | --- | --- |
| MP4 | General sharing; H.264, `yuv420p`, fast start | Synchronised soundtrack |
| WebM | Browser and open-web workflows; VP9 / Opus | Synchronised soundtrack |
| GIF | Short legacy-compatible animation | No |
| Animated WebP | Smaller web animation | No |
| PNG sequence | Editing, compositing and frame validation | Separate WAV |

Studio live recording and CLI frame-by-frame export are different pipelines. Use the CLI for reproducible output and fix the seed, viewport, frame rate, theme and dependency versions.
