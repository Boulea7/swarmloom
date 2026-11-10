# @swarmloom/adapter-html

The HTML adapter for SwarmLoom. Pipeline: HTML strings or URLs rendered in a sandboxed iframe, then snapshotted. The package exports a stub `Adapter` with its id, extensions and MIME types; `load()` throws until the implementation lands. Load it through `@swarmloom/formats` so it is only fetched when needed.

License: MIT.
