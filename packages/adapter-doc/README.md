# @swarmloom/adapter-doc

The Legacy DOC adapter for SwarmLoom. Pipeline: Word 97-2003 binary files parsed to styled paragraphs, then snapshotted. The package exports a stub `Adapter` with its id, extensions and MIME types; `load()` throws until the implementation lands. Load it through `@swarmloom/formats` so it is only fetched when needed.

License: MIT.
