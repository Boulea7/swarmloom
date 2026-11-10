# @swarmloom/adapter-pdf

The PDF adapter for SwarmLoom. Pipeline: page bitmaps plus text, image and path items revealed region by region. The package exports a stub `Adapter` with its id, extensions and MIME types; `load()` throws until the implementation lands. Load it through `@swarmloom/formats` so it is only fetched when needed.

License: MIT.
