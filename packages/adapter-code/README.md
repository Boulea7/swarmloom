# @swarmloom/adapter-code

The source code adapter for SwarmLoom (id `code`). It lays code out as an editor panel (title bar, line-number gutter, no soft wrap, font size fitted to the width, original light and dark themes). Each non-blank line becomes a `code` text layer revealed by typing (`reveal: "type"`) with per-token colours. Indent guides are built first, then the code, then the line numbers.

```ts
import { codeAdapter, detectLanguage } from "@swarmloom/adapter-code";

detectLanguage({ name: "swarm.ts", text }); // "typescript"
const { blueprint, warnings } = await codeAdapter.load({ name: "swarm.ts", text }, ctx);
```

The language comes from the file name, then the MIME type, a shebang or modeline, and finally content heuristics. `language` forces one. Highlighting uses a private highlight.js instance. The core and each grammar are dynamic imports, so nothing is loaded until a file needs it and only that grammar is fetched. Unknown languages render as plain text.

The package also hosts the pieces shared by the text adapters: `highlight` (used by the Markdown adapter for fenced code), `readSource` (text, URL and bytes, with size limits), `loadSnapshotDom` and the `LoadedText` and `TextAdapter` types (a `LoadedSource` with `warnings`).

Limits: 2 MiB of input (`maxBytes`) and 1500 rendered lines (`maxLines`). The rest is reported in `Blueprint.truncated` and `warnings`.

License: MIT. highlight.js is BSD-3-Clause.
