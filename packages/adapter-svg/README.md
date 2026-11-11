# @swarmloom/adapter-svg

The SVG adapter for SwarmLoom. It turns an SVG document into a blueprint that the stage rebuilds stroke by stroke. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { svgAdapter } from "@swarmloom/adapter-svg";

const { blueprint, plugins } = await svgAdapter.load({ text }, { document, width: 960, theme: "light" });
```

How it works:

- The markup is parsed with `DOMParser` and sanitised against an allow-list: no scripts, event handlers, `foreignObject` or external references (only `#fragment` links and `data:image/*` images are kept). SMIL elements (`animate`, `animateTransform`, `animateMotion`, `set`, `mpath`) are kept, except animations of links, event handlers or `style`, or whose values point outside the document. CSS escapes are decoded before `url()`, `@import` and similar are checked. Removed content is reported in `blueprint.truncated`.
- `<use>` references are expanded (with cycle, depth and clone limits). The SVG is then laid out in an invisible sandbox, so transforms, CSS and nested viewports resolve exactly as the browser draws them.
- Basic shapes and paths become path layers in stage coordinates, scaled to `ctx.width` with the aspect ratio kept. A drawing that would then be taller than a 16:9 frame is fitted whole into the frame instead, so logos and square charts end fully in view; one that would end up narrower than half the width that way (a long diagram) keeps the full width and scrolls. `createSvgAdapter({ fit: "width" })` always fills the width, for callers that lay the drawing out in stage space themselves (the Lottie adapter). Fill, stroke, opacity, line caps and joins, dashes, fill rules and markers are kept. Stroked paths are revealed with the pen (`meta.anchors` holds the pen anchors from the path commands); filled outlines are traced and then filled.
- Gradients, patterns, clip paths, masks, filters and markers are rewritten into stage space and placed in one `svg:defs` custom layer. The `svg` plugin returned from `load()` (`svgPlugin`) mounts them as a hidden `<svg><defs>` in the stage and sanitises the markup again before mounting it.
- Text becomes text layers, one per line with its styled runs. Text that cannot be expressed as HTML (text on a path, gradient fills, clipped or filtered text) becomes a vector snapshot image that is revealed by typing.
- `<image>` becomes an image layer. Repeated `<use>` clones are marked as duplicates (`master`) of their first instance.
- Paint order is kept in `z` and `priority`. Layers past `maxLayers` are dropped and counted in `truncated`.
- SMIL animation (decision C04): the authored, un-animated drawing is woven first. Then an `svg:smil` custom layer, built last, fades in the sanitised animated copy and plays it from 0 s (`setCurrentTime(0)`): it follows player time while the build runs, so exports stay frame-exact, and runs on its own clock (`unpauseAnimations()`) once the stage goes live. Exports pass `createSvgAdapter({ liveClock: "player" })`: their virtual clock keeps ticking after go live, so the drawing stays on player time and every frame stays exact. `<use>` instances animate with their source. Each animated drawing gets its own plugin instance (`createSvgPlugin()`).
- Keyframe timeline: when the load context carries an `anim:timeline` plugin (`ctx.plugins`, type `SvgLoadContext`; the plugin comes from `@swarmloom/adapter-lottie` and is looked up by name, not imported), the blueprint gets a band under the drawing with an `anim:timeline` layer (`duration`, `keyframes` from `begin`, `dur`, `keyTimes`/`values`), built before the replay. Without the plugin nothing changes.

Options (`createSvgAdapter`): `maxLayers` (4000), `maxBytes` (16 MiB), `maxElements` (50 000), `anchorsPerPath` (32), `assetTimeout` (1500 ms for fonts and image sizes), `liveClock` (`"own"`), `fit` (`"frame"`).

Limits: CSS animations inside the SVG are not replayed (the first frame is used); SMIL animations that begin on events only start once the stage is live. CSS basic-shape `clip-path` values are ignored. Filters under non-uniform scaling are approximated.

License: MIT.
