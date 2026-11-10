# @swarmloom/adapter-image

The Image adapter for SwarmLoom. Pipeline: raster images sketched from edges, then painted in tiles. The package exports a stub `Adapter` with its id, extensions and MIME types; `load()` throws until the implementation lands. Load it through `@swarmloom/formats` so it is only fetched when needed.

License: MIT.
