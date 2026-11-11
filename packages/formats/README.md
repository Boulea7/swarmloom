# @swarmloom/formats

Works out what an input is and loads it through the matching SwarmLoom adapter. Adapters are imported dynamically, so bundlers give each format its own chunk and nothing heavy is fetched until a file of that type is opened.

```ts
import { detect, load, SourceError } from "@swarmloom/formats";

const input = { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
const id = await detect(input); // "markdown", "pdf", ... or null
const source = await load(input, { document, width: 960, theme: "light" }, { maxBytes: 20 * 1024 * 1024 });
```

## Detection

`detect(input)` returns an adapter id (`dom`, `html`, `markdown`, `code`, `docx`, `doc`, `pdf`, `svg`, `image`, `slides`, `sheet`, `three`, `odf`, `epub`, `rtf`, `ofd`, `notebook`, `terminal`, `diff`, `mindmap`, `lottie`) or `null`. `inspect(input)` does the same synchronously and also reports `encrypted`. The checks run in this order, and the first match wins:

1. `input.element`: `dom`.
2. ZIP containers: a small central-directory reader (with a local-header fallback for truncated heads) looks at the entry names. `word/` gives `docx`, `ppt/` gives `slides`, `xl/` gives `sheet`, the `mimetype` entry gives `sheet` for ODS, `odf` for other OpenDocument types and `epub` for EPUB, a root `OFD.xml` gives `ofd`, a root `manifest.json` with an `animations/<id>.json` or `a/<id>.json` entry gives `lottie` (dotLottie), and a root `content.json` or `content.xml` without a `mimetype` entry gives `mindmap` (XMind). An encrypted entry sets `encrypted`.
3. Compound File Binary (legacy Office): the `WordDocument`, `Workbook` and `PowerPoint Document` streams. Legacy `.xls` and `.ppt` files reach the spreadsheet and presentation adapters this way only so they can explain that the file must be saved as `.xlsx` or `.pptx`; the registry does not list those extensions. `EncryptionInfo`, `EncryptedPackage` or the Word FIB encryption flag set `encrypted`.
4. Magic bytes: PDF, RTF (so RTF saved as `.doc` opens as RTF), glTF binary, PLY, binary STL, PNG, JPEG, GIF, WebP, AVIF and BMP.
5. Each registry entry's `sniff()` (Lottie JSON, so it opens as an animation under its usual `.json` name), then the file extension, then the MIME type (generic types such as `text/plain` are ignored).
6. Text heuristics: SVG and HTML roots, Jupyter notebooks, asciicast recordings, patches, FreeMind maps, glTF JSON, OBJ and ASCII STL, Lottie JSON (before other JSON, which is code), CSV/TSV delimiter consistency, then weighted Markdown and code signals.

Only ids present in the registry you pass are returned.

## Loading

`load(input, ctx?, options?)` validates the input, fetches it when only `url` is given (http, https, data, blob and file URLs, streamed with a size cap), detects the format, imports the adapter and calls `adapter.load`. Options:

- `format`: an id, extension or MIME type that overrides detection.
- `registry`: the format list to use.
- `maxBytes`: the size limit, 50 MB by default.
- `fetch: false`: do not download URL-only inputs. They go to the adapter untouched (`maxBytes` does not apply to them) and the adapter fetches them itself, so this does not block URL loading; to refuse URLs, check the input before calling `load()`.
- `signal`: abort the load.

A failure rejects with a `SourceError`. Its `message` explains what to do, and its `code` is one of:

| code | meaning |
| --- | --- |
| `unsupported` | No adapter matches; the message lists the supported formats. |
| `too-large` | The input or download is over `maxBytes`. |
| `empty` | No bytes, text, URL or element. |
| `encrypted` | A password-protected document. Adapters that throw `PasswordException` are mapped here too. |
| `fetch-failed` | The network error, HTTP status or URL protocol is not allowed. |
| `adapter-unavailable` | The adapter chunk could not be imported. |

Aborting rejects with `signal.reason`, and a source that loads after the abort is disposed.

## Registry

`formats` is the default registry: extensions, MIME types, a `sniff()` and a lazy `loader()` per adapter. `@swarmloom/formats/meta` exports the same metadata (`FORMAT_META`) and `createRegistry(loader)`, without any adapter imports. Use it to build a registry that loads adapters some other way. The CDN build of `<swarm-loom>` does this. The registry module stays under 3 KB gzip. The detection code is separate (about 5 KB gzip).

License: MIT.
