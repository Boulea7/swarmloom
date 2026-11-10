# @swarmloom/adapter-svg

The SVG adapter for SwarmLoom. It turns an SVG document into a blueprint that the stage rebuilds stroke by stroke. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { svgAdapter } from "@swarmloom/adapter-svg";

const { blueprint, plugins } = await svgAdapter.load({ text }, { document, width: 960, theme: "light" });
```

How it works:

- The markup is parsed with `DOMParser` and sanitised against an allow-list: no scripts, event handlers, `foreignObject`, animation elements, or external references (only `#fragment` links and `data:image/*` images are kept). CSS escapes are decoded before `url()`, `@import` and similar are checked. Removed content is reported in `blueprint.truncated`.
- `<use>` references are expanded (with cycle, depth and clone limits). The SVG is then laid out in an invisible sandbox, so transforms, CSS and nested viewports resolve exactly as the browser draws them.
- Basic shapes and paths become path layers in stage coordinates, scaled to `ctx.width` with the aspect ratio kept. Fill, stroke, opacity, line caps and joins, dashes, fill rules and markers are kept. Stroked paths are revealed with the pen (`meta.anchors` holds the pen anchors from the path commands); filled outlines are traced and then filled.
- Gradients, patterns, clip paths, masks, filters and markers are rewritten into stage space and placed in one `svg:defs` custom layer. The `svg` plugin returned from `load()` (`svgPlugin`) mounts them as a hidden `<svg><defs>` in the stage and sanitises the markup again before mounting it.
- Text becomes text layers, one per line with its styled runs. Text that cannot be expressed as HTML (text on a path, gradient fills, clipped or filtered text) becomes a vector snapshot image that is revealed by typing.
- `<image>` becomes an image layer. Repeated `<use>` clones are marked as duplicates (`master`) of their first instance.
- Paint order is kept in `z` and `priority`. Layers past `maxLayers` are dropped and counted in `truncated`.

Options (`createSvgAdapter`): `maxLayers` (4000), `maxBytes` (16 MiB), `maxElements` (50 000), `anchorsPerPath` (32), `assetTimeout` (1500 ms for fonts and image sizes).

Limits: SMIL and CSS animations are not run (the first frame is used). CSS basic-shape `clip-path` values are ignored. Filters under non-uniform scaling are approximated.

License: MIT.
