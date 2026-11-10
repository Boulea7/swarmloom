# @swarmloom/adapter-docx

The DOCX adapter for SwarmLoom. Pipeline: Word documents rendered as paged HTML, then snapshotted. The package exports a stub `Adapter` with its id, extensions and MIME types; `load()` throws until the implementation lands. Load it through `@swarmloom/formats` so it is only fetched when needed.

License: MIT.
