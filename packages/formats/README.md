# @swarmloom/formats

Detects what an input is (by magic bytes, file extension, MIME type and simple content sniffing) and loads it through the matching SwarmLoom adapter. Adapters are imported dynamically, so bundlers split each format into its own chunk and nothing heavy is fetched until a file of that type is opened.

License: MIT.
