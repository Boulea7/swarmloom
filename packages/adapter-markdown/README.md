# @swarmloom/adapter-markdown

The Markdown (GFM) adapter for SwarmLoom. Pipeline: themed HTML rendered in a sandbox, then snapshotted. The package exports a stub `Adapter` with its id, extensions and MIME types; `load()` throws until the implementation lands. Load it through `@swarmloom/formats` so it is only fetched when needed.

License: MIT.
